const root = require("path").join(__dirname, "..", "..");

const binding = require("node-gyp-build")(root);

module.exports = binding;

try {
  binding.nodeTypeInfo = require("../../postgres/src/node-types.json");
} catch (_) {}

try {
  if (binding.plpgsql) {
    binding.plpgsql.nodeTypeInfo = require("../../plpgsql/src/node-types.json");
  }
} catch (_) {}
