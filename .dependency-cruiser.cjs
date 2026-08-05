// Module-boundary enforcement for the modular monolith (see Chronicle-architecture.md §2).
//
// Business contexts (extraction, ingestion, knowledge-modeling, processing)
// expose a public `index.ts`; every other context must import them through it,
// never through an internal file. `shared/`, `persistence/`, and `lib/` are
// cross-cutting infrastructure, freely importable.
//
// Within-module internal imports are allowed; `src/tests` may reach into module
// internals on purpose. Each boundary rule therefore excludes its own module and
// the tests from the `from` side, and its index from the `to` side.
module.exports = {
  options: {
    doNotFollow: { path: '^node_modules' },
    tsConfig: { fileName: './tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
  forbidden: [
    {
      name: 'no-extraction-internals',
      severity: 'error',
      comment: 'Import extraction through its index.ts, not internal files.',
      from: { pathNot: '^src/modules/extraction/|^src/tests/' },
      to: { path: '^src/modules/extraction/', pathNot: '^src/modules/extraction/index\\.ts$' },
    },
    {
      name: 'no-ingestion-internals',
      severity: 'error',
      comment: 'Import ingestion through its index.ts, not internal files.',
      from: { pathNot: '^src/modules/ingestion/|^src/tests/' },
      to: { path: '^src/modules/ingestion/', pathNot: '^src/modules/ingestion/index\\.ts$' },
    },
    {
      name: 'no-knowledge-modeling-internals',
      severity: 'error',
      comment: 'Import knowledge-modeling through its index.ts, not internal files.',
      from: { pathNot: '^src/modules/knowledge-modeling/|^src/tests/' },
      to: {
        path: '^src/modules/knowledge-modeling/',
        pathNot: '^src/modules/knowledge-modeling/index\\.ts$',
      },
    },
    {
      name: 'no-processing-internals',
      severity: 'error',
      comment: 'Import processing through its index.ts, not internal files.',
      from: { pathNot: '^src/modules/processing/|^src/tests/' },
      to: { path: '^src/modules/processing/', pathNot: '^src/modules/processing/index\\.ts$' },
    },
    {
      name: 'no-cycles-between-business-modules',
      severity: 'error',
      comment:
        'Business contexts must not depend on each other in a cycle (would block a future split).',
      from: { path: '^src/modules/(extraction|ingestion|knowledge-modeling|processing)/' },
      to: {
        path: '^src/modules/(extraction|ingestion|knowledge-modeling|processing)/',
        circular: true,
      },
    },
    {
      name: 'no-module-to-web-layer',
      severity: 'error',
      comment: 'Business contexts must never depend on the web layer (app routes or components).',
      from: { path: '^src/modules/' },
      to: { path: '^src/(app|components)/' },
    },
  ],
};
