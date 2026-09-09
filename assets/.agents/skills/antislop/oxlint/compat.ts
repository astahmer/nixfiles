/**
 * The portable plugin is loaded by Oxlint, so it does not need the optional
 * ESLint bridge package used by the source repositories. Keep these helpers
 * local so the skill is runnable from the deployed global agent tree.
 */
export const defineRule = <T>(rule: T): T => rule;

export const eslintCompatPlugin = <T>(plugin: T): T => plugin;

export type SourceCode = any;
export type Scope = any;
export type Variable = any;

export namespace ESTree {
	export type ArrowFunctionExpression = any;
	export type Expression = any;
	export type Function = any;
	export type FunctionDeclaration = any;
	export type Identifier = any;
	export type IdentifierReference = any;
	export type Node = any;
	export type ParamPattern = any;
	export type Program = any;
	export type PropertyKey = any;
	export type Statement = any;
	export type TSAsExpression = any;
	export type TSCallSignatureDeclaration = any;
	export type TSConstructSignatureDeclaration = any;
	export type TSConstructorType = any;
	export type TSEmptyBodyFunctionExpression = any;
	export type TSFunctionType = any;
	export type TSInterfaceDeclaration = any;
	export type TSMappedType = any;
	export type TSMethodSignature = any;
	export type TSType = any;
	export type TSTypeAliasDeclaration = any;
	export type TSTypeAnnotation = any;
	export type TSTypeLiteral = any;
	export type TSTypeReference = any;
	export type TSTypeAssertion = any;
	export type TSSignature = any;
	export type UnaryExpression = any;
	export type VariableDeclarator = any;
}
