# Portable anti-slop rule catalog

These are generic rule candidates extracted from the project-owned Oxlint
plugins. They are deliberately framework-neutral and should be enabled by a
project's own lint configuration, not assumed to fit every codebase.

## Adoption policy

Use the generic rules in this catalog as selectable Oxlint and ast-grep
profiles, not as an unconditional policy for every repository. Enable a rule
only after checking its false-positive surface against the repository's
boundaries and adding fixtures.

The strongest generic TypeScript baseline is:

- no-chained-type-assertions
- no-broad-object-parameters
- no-reflect-get
- no-reflect-apply
- no-widen-then-assert
- no-unknown-parameters
- no-unknown-returns
- no-unknown-type-aliases
- no-unsafe-dictionary-type
- require-safety-comment-for-type-assertion
- no-known-value-widening

The module-boundary rules are also reusable, but need project configuration
for public boundary filenames and barrel suffixes:

- no-wildcard-export
- no-index-import
- no-internal-export-boundary-import
- no-internal-forwarding-class
- no-export-from

Readability and data-boundary rules:

- no-deeply-nested-ternary
- no-conditional-empty-object-spread
- no-runtime-typeof

Enable no-module-mocking separately after confirming that the test architecture
uses real dependency seams or injected fakes. Keep it opt-in for projects
whose test framework or legacy tests genuinely depend on module replacement.

Every enabled rule needs:

1. an avoid/prefer/why entry in the project's anti-slop ledger;
2. at least one valid and one invalid fixture;
3. a focused checker test;
4. documented, narrow exceptions;
5. exactly one implementation in Oxlint or ast-grep.

## no-chained-type-assertions

Avoid nested TypeScript assertions such as:

    const value = input as unknown as User;

Prefer parsing or validating untrusted input at its boundary, or preserve the
original precise type until a real narrowing operation is available.

The checker should detect as assertions, angle-bracket assertions, and
parenthesized chains. It may allow an explicit SAFETY: comment when a generated
or external contract makes the assertion unavoidable. Const-only assertions
such as as const are not the target.

Why: each assertion can discard evidence from the previous type and makes an
unsafe boundary look typed.

## Additional type-evidence rules

no-widen-then-assert catches a known value that is explicitly widened into an
anonymous or broad local type and later asserted back to a narrower type.
Preserve the precise type from initialization through use, or parse boundary
input once.

no-unknown-parameters rejects unknown function inputs except deliberately
named error-cause or boundary-normalizer cases. Decode external values before
calling internal functions.

no-unknown-returns rejects unknown and Promise-of-unknown return contracts.
Return a named validated type so callers receive a usable contract.

no-unknown-type-aliases rejects aliases that merely hide unknown. Keep unknown
visible at the parsing boundary instead of laundering it through a named alias.

no-unsafe-dictionary-type rejects dictionary value contracts whose direct
value type is unknown, any, object, empty object, or a union or alias
containing one of those escape hatches. Use a named or schema-derived value
type.

require-safety-comment-for-type-assertion requires a nearby SAFETY comment for
non-const and non-never assertions. The comment must state the invariant that
the type system cannot express.

no-runtime-typeof rejects typeof checks used as a substitute for decoding
unparsed values. Configure narrow exceptions for environment checks, genuine
type guards, and boundary helpers.

no-known-value-widening rejects explicit broad or anonymous target types when
the initializer already provides reliable type evidence. Preserve inference,
use satisfies, or use a named owner contract.

## no-broad-object-parameters

Avoid accepting the broad object type in function, method, callback, and
signature parameters:

    function configure(options: object) {}

Prefer a named owner-provided type, a precise structural type, or a boundary
parser that produces a domain type before calling the function.

Resolve simple local type aliases and unions, while respecting shadowed type
parameters. Do not flag unrelated object-shaped types merely because they are
structural.

Why: broad inputs erase the contract at the point where callers need it most.

## no-reflect-get and no-reflect-apply

Avoid global Reflect.get and Reflect.apply in ordinary application code.
Prefer typed property access and direct typed calls. Model intentional dynamic
dispatch behind a named interface or a validated adapter.

The checker must distinguish the global Reflect object from a locally shadowed
binding. This identity check is why these rules belong in Oxlint rather than a
blind syntax matcher.

Why: reflective access bypasses ordinary type evidence and hides the contract
between the caller and the value being accessed.

## no-module-mocking

Avoid Vitest or Jest module replacement such as vi.mock, vi.doMock,
vi.unstable_mockModule, and jest.mock when testing application behavior.
Prefer dependency injection through a real interface, service layer, or
faithful in-memory implementation.

Resolve imported and global framework objects before reporting, and support
both direct and computed method access. Allow project-specific test-only
exceptions only when they are narrow and documented.

Why: module mocks replace the wiring the application actually runs and can
make tests pass while the real dependency seam is broken.

## Module and control-flow rules

no-wildcard-export rejects export-star forwarding in implementation modules.
Allow only explicitly configured public boundary files to compose the package
API.

no-index-import rejects internal imports that name an index.ts barrel. Import
the named implementation or an explicit public export file.

no-internal-export-boundary-import rejects internal imports through a package
export boundary such as mod.ts or a configured export suffix. Keep internal
code on implementation files and reserve boundaries for consumers.

no-internal-forwarding-class rejects classes that expose a static readonly
field solely by forwarding another domain's member. Use the owning domain
directly instead of adding a nominal wrapper with no behavior.

no-export-from rejects implementation-level re-exports. Public boundary
files may own explicit bindings or use a configured composition pattern.

These five rules are intentionally configurable: index files, mod files,
export files, and package boundaries differ across repositories. Do not
hardcode one project's directory names into a shared checker.

no-deeply-nested-ternary rejects three-or-more-level cascading ternaries.
Prefer a Record, switch, or explicit state branches.

no-conditional-empty-object-spread rejects conditional spreads that add an
empty object in one branch. Prefer an explicit branch or a named builder so
the output shape stays obvious.

## Generic ast-grep rules

no-raw-response-json-assertion is the generic name for the response JSON rule.
Reject an assertion directly on await response.json() and decode the payload
through a runtime schema or boundary parser. Keep TypeScript and TSX variants,
ignore tests where appropriate, and allow one named decoder shim.

no-direct-json-parse rejects direct JSON.parse at untrusted or transport
boundaries. Decode through the repository's validated parser instead. The
rule must not mention Effect in its generic message; Effect projects can
select a stricter profile.

These two rules are structural and fit ast-grep. Do not add a second Oxlint
implementation unless the project needs semantic source or scope resolution.

## Deliberate non-adoptions

Do not promote project-specific Effect, workflow, dependency-injection,
symbol-vocabulary, or repository-path rules into the generic catalog. Select
the effect-antislop profile for those rules. Deduplicate repeated rule names
from source projects rather than creating aliases for the same check.
