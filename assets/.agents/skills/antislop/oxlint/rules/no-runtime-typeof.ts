import { defineRule } from "../compat.ts";

import type { ESTree, SourceCode } from "../compat.ts";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isRuntimeFunction(node: ESTree.Node): node is RuntimeFunction {
	return (
		node.type === "ArrowFunctionExpression" ||
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression"
	);
}

function isInsideTypeGuard(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (isRuntimeFunction(current)) {
			return current.returnType?.typeAnnotation.type === "TSTypePredicate";
		}
		current = current.parent;
	}
	return false;
}

function functionName(node: RuntimeFunction, sourceText: string): string {
	if (node.id?.type === "Identifier") return node.id.name;
	const parent = node.parent;
	if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
		return parent.id.name;
	}
	if (
		(parent.type === "Property" || parent.type === "MethodDefinition") &&
		(parent.key.type === "Identifier" || parent.key.type === "Literal")
	) {
		return String(parent.key.name ?? parent.key.value);
	}
	return sourceText;
}

function isBoundaryFunctionName(name: string): boolean {
	return /^[A-Z]|^(?:as|audit|bind|check|component|convert|decode|error|extract|format|get|has|is|normalize|number|parse|read|resolve|run|same|set|theme|to|validate|value)(?:[A-Z]|$)/u.test(
		name,
	);
}

function isInsideBoundaryFunction(node: ESTree.Node, sourceCode: SourceCode): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (isRuntimeFunction(current)) {
			if (isBoundaryFunctionName(functionName(current, sourceCode.getText(current)))) return true;
			if (
				/\b[A-Za-z_$][\w$]*\??\s*:\s*(?:string|number|boolean|Date|readonly|[A-Z_$][\w$]*)/u.test(
					sourceCode.getText(current),
				)
			) {
				return true;
			}
		}
		current = current.parent;
	}
	return false;
}

function hasExplicitTypeAnnotation(identifier: ESTree.Identifier, sourceCode: SourceCode): boolean {
	let scope = sourceCode.getScope(identifier);
	while (scope !== null) {
		const variable = scope.set.get(identifier.name);
		if (variable !== undefined) {
			for (const definition of variable.defs) {
				const node = definition.node;
				if (
					"typeAnnotation" in node &&
					node.typeAnnotation !== null &&
					node.typeAnnotation !== undefined &&
					node.typeAnnotation.typeAnnotation.type !== "TSUnknownKeyword"
				) {
					return true;
				}
				if (node.type === "VariableDeclarator" && node.init?.type === "MemberExpression") {
					return true;
				}
			}
		}
		scope = scope.upper;
	}
	return false;
}

function unwrapTypeofOperand(node: ESTree.Expression): ESTree.Expression {
		return node.type === "ChainExpression" ? node.expression : node;
}

function isStaticallyTypedValue(node: ESTree.UnaryExpression, sourceCode: SourceCode): boolean {
	const operand = unwrapTypeofOperand(node.argument);
	if (operand.type === "MemberExpression") return true;
	if (operand.type === "Identifier") return hasExplicitTypeAnnotation(operand, sourceCode);
	return operand.type === "Literal";
}

function isInsideArrayCallback(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (isRuntimeFunction(current)) {
			const parent = current.parent;
			if (
				parent.type === "CallExpression" &&
				parent.callee.type === "MemberExpression" &&
				!parent.callee.computed &&
				parent.callee.property.type === "Identifier" &&
				new Set(["every", "filter", "find", "flatMap", "map", "reduce", "some"]).has(
					parent.callee.property.name,
				)
			) {
				return true;
			}
		}
		current = current.parent;
	}
	return false;
}

function isInsideEffectFn(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (isRuntimeFunction(current)) {
			const parent = current.parent;
			if (
				parent.type === "CallExpression" &&
				parent.callee.type === "MemberExpression" &&
				!parent.callee.computed &&
				parent.callee.object.type === "Identifier" &&
				parent.callee.object.name === "Effect" &&
				parent.callee.property.type === "Identifier" &&
				parent.callee.property.name === "fn"
			) {
				return true;
			}
		}
		current = current.parent;
	}
	return false;
}

/** Disallow runtime typeof checks that narrow unparsed values instead of decoding them. */
export const noRuntimeTypeofRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
		},
		messages: {
			runtimeTypeof:
				"A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowInTypeGuards: { type: "boolean" },
					allowInBoundaryFunctions: { type: "boolean" },
					allowWhenStaticallyTyped: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ allowInTypeGuards: false }],
	},
	createOnce(context) {
		return {
			UnaryExpression(node) {
				const option = context.options?.[0];
				const allowInTypeGuards =
					typeof option === "object" &&
					option !== null &&
					!Array.isArray(option) &&
					option.allowInTypeGuards === true;
				const allowInBoundaryFunctions =
					typeof option === "object" &&
					option !== null &&
					!Array.isArray(option) &&
					option.allowInBoundaryFunctions === true;
				const allowWhenStaticallyTyped =
					typeof option === "object" &&
					option !== null &&
					!Array.isArray(option) &&
					option.allowWhenStaticallyTyped === true;
				const operand = node.argument;
				const isEnvironmentCheck =
					operand.type === "Identifier" &&
					new Set(["document", "globalThis", "process", "window"]).has(operand.name);
				if (
					node.operator === "typeof" &&
					!isEnvironmentCheck &&
					!isInsideArrayCallback(node) &&
					!isInsideEffectFn(node) &&
					(!allowWhenStaticallyTyped || !isStaticallyTypedValue(node, context.sourceCode)) &&
					(!allowInTypeGuards || !isInsideTypeGuard(node)) &&
					(!allowInBoundaryFunctions ||
						!isInsideBoundaryFunction(node, context.sourceCode))
				) {
					context.report({ node, messageId: "runtimeTypeof" });
				}
			},
		};
	},
});
