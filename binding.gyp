{
  "targets": [
    {
      "target_name": "tree_sitter_postgres_binding",
      "dependencies": [
        "<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except",
      ],
      "include_dirs": [
        "postgres/src",
        "plpgsql/src",
      ],
      "sources": [
        "bindings/node/binding.cc",
        "postgres/src/parser.c",
        "plpgsql/src/parser.c",
        "plpgsql/src/scanner.c",
      ],
      "conditions": [
        ["OS!='win'", {
          "cflags_c": [
            "-std=c11",
          ],
        }, { # OS == "win"
          "cflags_c": [
            "/std:c11",
            "/utf-8",
          ],
        }],
      ],
    }
  ]
}
