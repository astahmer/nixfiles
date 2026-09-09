import { defineRule } from "../compat.ts";

import type { ESTree, SourceCode } from "../compat.ts";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const commentOwnerKinds = new Set([
	"ExpressionStatement",
	"PropertyDefinition",
	"ReturnStatement",
	"ThrowStatement",
	"VariableDeclaration",
	"ExportNamedDeclaration",
]);

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

function isNeverAssertion(node: TypeAssertion): boolean {
	return (
		node.typeAnnotation.type === "TSNeverKeyword" ||
		(node.typeAnnotation.type === "TSTypeReference" &&
			node.typeAnnotation.typeName.type === "Identifier" &&
			node.typeAnnotation.typeName.name === "never")
	);
}

function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion): boolean {
	let current: ESTree.Node = node;
	while (true) {
		if (/\bSAFETY\s*:/u.test(sourceCode.getText(current))) return true;
		const commentsBefore = [
			...sourceCode.getCommentsBefore(current),
			...(current.type === "TSAsExpression" || current.type === "TSTypeAssertion"
				? sourceCode.getCommentsBefore(current.expression)
				: []),
		];
		if (commentsBefore.some((comment) => comment.end <= node.start && /\bSAFETY\s*:/u.test(comment.value))) {
			return true;
		}
		if (
			sourceCode
				.getCommentsAfter(current)
				.some((comment) => comment.start >= node.end && /\bSAFETY\s*:/u.test(comment.value))
		) {
			return true;
		}
		const exportedVariableDeclaration =
			current.type === "VariableDeclaration" && current.parent.type === "ExportNamedDeclaration";
		if (
			(commentOwnerKinds.has(current.type) && !exportedVariableDeclaration) ||
			current.parent.type === "Program"
		) {
			return false;
		}
		current = current.parent;
	}
}

/** Require every non-const type assertion to state the invariant TypeScript cannot express. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
		description:
			"Require a nearby SAFETY comment for every TypeScript type assertion except const and never assertions.",
    },
    messages: {
      missingSafetyComment:
        "This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.",
    },
  },
  createOnce(context) {
    const checkAssertion = (node: TypeAssertion) => {
			if (isConstAssertion(node) || isNeverAssertion(node) || hasSafetyComment(context.sourceCode, node)) {
				return;
			}
      context.report({ node, messageId: "missingSafetyComment" });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
