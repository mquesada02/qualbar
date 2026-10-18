// Oxc-based estimate of Stryker 10.0.0 mutant counts per file and per mutator.
// Usage: node estimate.mjs <root> <file...>  -> JSON { file: { total, byMutator } }
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";

// Subtrees Stryker never visits (instrumenter util/syntax-helpers.js isTypeNode, isImportDeclaration, decorators).
const SKIP = new Set([
  "TSAsExpression", "TSInterfaceDeclaration", "TSTypeAnnotation", "TSTypeAliasDeclaration",
  "TSEnumDeclaration", "TSDeclareFunction", "TSTypeParameterInstantiation", "TSTypeParameterDeclaration",
  "ImportDeclaration", "TSImportEqualsDeclaration", "Decorator",
]);
const BOOL_OPS = new Set(["!=", "!==", "&&", "<", "<=", "==", "===", ">", ">=", "||"]);
const EQ = { "<": 2, "<=": 2, ">": 2, ">=": 2, "==": 1, "!=": 1, "===": 1, "!==": 1 };
const ARITH = new Set(["+", "-", "*", "/", "%"]);
const ASSIGN = new Set(["+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "&&=", "||=", "??="]);
const METHOD_PAIRS = [
  ["endsWith", "startsWith"], ["every", "some"], ["toLocaleLowerCase", "toLocaleUpperCase"],
  ["toLowerCase", "toUpperCase"], ["trimEnd", "trimStart"], ["min", "max"], ["setDate", "setTime"],
  ["setFullYear", "setMonth"], ["setHours", "setMinutes"], ["setSeconds", "setMilliseconds"],
  ["setUTCDate", "setTime"], ["setUTCFullYear", "setUTCMonth"], ["setUTCHours", "setUTCMinutes"],
  ["setUTCSeconds", "setUTCMilliseconds"],
];
const METHODS = new Set(["charAt", "filter", "reverse", "slice", "sort", "substr", "substring", "trim", ...METHOD_PAIRS.flat()]);

const isStr = (n) => n?.type === "TemplateLiteral" || (n?.type === "Literal" && typeof n.value === "string");
const isNode = (v) => v !== null && typeof v === "object" && typeof v.type === "string";
const isDeclare = (n) => (n.type === "VariableDeclaration" || n.type === "TSModuleDeclaration") && n.declare === true;

// Rough weapon-regex level-1 count: anchors, quantifiers, char classes, predefined classes.
function regexEstimate(pattern) {
  if (!pattern) return 0;
  const m = pattern.match(/\\[dDwWsSbB]|[\^$]|[*+?](?!\?)|\{\d+(,\d*)?\}|\[\^?/g);
  return m ? m.length : 0;
}

function stringParentOk(node, parent, key) {
  if (!parent) return true;
  const t = parent.type;
  if (t === "ImportDeclaration" || t.startsWith("Export") || t === "TSExternalModuleReference" ||
      t === "JSXAttribute" || t === "ExpressionStatement" || t === "TSLiteralType" || t === "ImportExpression") return false;
  if ((t === "Property" || t === "PropertyDefinition" || t === "MethodDefinition") && key === "key") return false;
  if (t === "CallExpression" && parent.callee.type === "Identifier" &&
      (parent.callee.name === "require" || parent.callee.name === "Symbol")) return false;
  return true;
}

function constructorBlockInvalid(fn, method, classBody) {
  if (!method || method.kind !== "constructor") return false;
  const paramProps = fn.params.some((p) => p.type === "TSParameterProperty");
  const initProps = classBody?.body.some((m) => m.type === "PropertyDefinition" && m.value) ?? false;
  return (paramProps || initProps) && JSON.stringify(fn.body).includes('"type":"Super"');
}

// Mutants on this exact node. ctx: { parent, key, method, classBody }
function own(node, ctx, add) {
  const { parent, key } = ctx;
  switch (node.type) {
    case "BinaryExpression":
      if (ARITH.has(node.operator)) {
        const left = node.left.type === "BinaryExpression" ? node.left.right : node.left;
        if (!isStr(node.right) && !isStr(left)) add("ArithmeticOperator", 1);
      }
      if (EQ[node.operator]) add("EqualityOperator", EQ[node.operator]);
      break;
    case "LogicalExpression":
      add("LogicalOperator", 1);
      break;
    case "ArrayExpression":
      add("ArrayDeclaration", 1);
      break;
    case "NewExpression":
    case "CallExpression":
      if (node.callee.type === "Identifier" && node.callee.name === "Array") add("ArrayDeclaration", 1);
      if (node.type === "CallExpression") {
        const c = node.callee;
        if (c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier" && METHODS.has(c.property.name)) add("MethodExpression", 1);
        if (node.optional) add("OptionalChaining", 1);
      }
      if (node.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "RegExp" &&
          node.arguments[0]?.type === "Literal" && typeof node.arguments[0].value === "string") {
        add("Regex", regexEstimate(node.arguments[0].value));
      }
      break;
    case "MemberExpression":
      if (node.optional) add("OptionalChaining", 1);
      break;
    case "ArrowFunctionExpression":
      if (node.expression && !(node.body.type === "Identifier" && node.body.name === "undefined")) add("ArrowFunction", 1);
      break;
    case "AssignmentExpression":
      if (ASSIGN.has(node.operator) && !(isStr(node.right) && !["&&=", "||=", "??="].includes(node.operator))) add("AssignmentOperator", 1);
      break;
    case "BlockStatement":
      if (node.body.length > 0 && !(key === "body" && ctx.ownerFn && constructorBlockInvalid(ctx.ownerFn, ctx.method, ctx.classBody))) add("BlockStatement", 1);
      break;
    case "Literal":
      if (typeof node.value === "boolean") add("BooleanLiteral", 1);
      else if (typeof node.value === "string" && stringParentOk(node, parent, key)) add("StringLiteral", 1);
      else if (node.regex) add("Regex", regexEstimate(node.regex.pattern));
      break;
    case "TemplateLiteral":
      add("StringLiteral", 1);
      break;
    case "UnaryExpression":
      if (node.operator === "!") add("BooleanLiteral", 1);
      if (["+", "-", "~"].includes(node.operator)) add("UnaryOperator", 1);
      break;
    case "UpdateExpression":
      add("UpdateOperator", 1);
      break;
    case "ObjectExpression":
      if (node.properties.length > 0) add("ObjectLiteral", 1);
      break;
    case "ForStatement":
      if (!node.test) add("ConditionalExpression", 1);
      break;
    case "SwitchCase":
      if (node.consequent.length > 0) add("ConditionalExpression", 1);
      break;
  }
  // ConditionalExpression mutator on expressions by position
  if (parent && key === "test" && ["ForStatement", "WhileStatement", "DoWhileStatement"].includes(parent.type)) {
    add("ConditionalExpression", 1);
  } else if (parent && key === "test" && parent.type === "IfStatement") {
    add("ConditionalExpression", 2);
  } else if ((node.type === "BinaryExpression" || node.type === "LogicalExpression") && BOOL_OPS.has(node.operator)) {
    const inLogical = parent?.type === "LogicalExpression" && (parent.operator === "||" || parent.operator === "&&");
    add("ConditionalExpression", inLogical ? 1 : 2);
  }
}

// Returns the subtree count and fills byMutator.
function walk(node, ctx, byMutator) {
  if (SKIP.has(node.type) || isDeclare(node)) return 0;
  let local = 0;
  const add = (m, n) => { if (n > 0) { byMutator[m] = (byMutator[m] ?? 0) + n; local += n; } };
  own(node, ctx, add);
  let sub = 0;
  for (const [k, v] of Object.entries(node)) {
    if (k === "parent") continue;
    const kids = Array.isArray(v) ? v.filter(isNode) : isNode(v) ? [v] : [];
    for (const child of kids) {
      // ChainExpression and ParenthesizedExpression are transparent: Babel has no such parent node.
      const transparent = node.type === "ChainExpression" || node.type === "ParenthesizedExpression";
      const childCtx = transparent ? { ...ctx } : {
        parent: node, key: k,
        method: node.type === "MethodDefinition" ? node : ctx.method && node.type === "FunctionExpression" ? ctx.method : undefined,
        ownerFn: /Function/.test(node.type) ? node : undefined,
        classBody: node.type === "ClassBody" ? node : node.type === "MethodDefinition" ? ctx.classBody : node.type === "FunctionExpression" ? ctx.classBody : undefined,
      };
      sub += walk(child, childCtx, byMutator);
    }
  }
  // CallExpression mutator (empty-expression): kept only when it is the only mutant in the statement subtree.
  if ((node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && node.expression.callee.type !== "Super") ||
      (node.type === "ThrowStatement" && node.argument.type === "NewExpression")) {
    if (local + sub === 0) add("CallExpression", 1);
  }
  return local + sub;
}

const [root, ...files] = process.argv.slice(2);
const out = {};
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const { program, errors } = parseSync(f, src, { preserveParens: false });
  if (errors.length) console.error(`parse errors in ${f}: ${errors.length}`);
  const byMutator = {};
  const total = walk(program, {}, byMutator);
  out[path.relative(root, f)] = { total, byMutator };
}
process.stdout.write(JSON.stringify(out));
