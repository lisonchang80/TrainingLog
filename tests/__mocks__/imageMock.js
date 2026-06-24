// Jest stub for bundled image assets (require('*.jpg|png|...')).
// Metro resolves these to an opaque asset module at bundle time; the node test
// environment can't parse the binary, so map every image require to this stub.
// Truthy value mirrors "a module ref exists" for resolveExerciseMedia() tests.
module.exports = 1;
