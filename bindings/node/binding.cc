#include <napi.h>

typedef struct TSLanguage TSLanguage;

extern "C" TSLanguage *tree_sitter_postgres();
extern "C" TSLanguage *tree_sitter_plpgsql();

// "tree-sitter", "language" hashed with BLAKE2
const napi_type_tag LANGUAGE_TYPE_TAG = {
    0x8AF2E5212AD58ABF, 0xD5006CAD83ABBA16
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    auto postgres = Napi::Object::New(env);
    postgres["name"] = Napi::String::New(env, "postgres");
    auto pg_language = Napi::External<TSLanguage>::New(env, tree_sitter_postgres());
    pg_language.TypeTag(&LANGUAGE_TYPE_TAG);
    postgres["language"] = pg_language;
    exports["postgres"] = postgres;

    auto plpgsql = Napi::Object::New(env);
    plpgsql["name"] = Napi::String::New(env, "plpgsql");
    auto plpg_language = Napi::External<TSLanguage>::New(env, tree_sitter_plpgsql());
    plpg_language.TypeTag(&LANGUAGE_TYPE_TAG);
    plpgsql["language"] = plpg_language;
    exports["plpgsql"] = plpgsql;

    // Backwards compatibility: export postgres as the default
    exports["name"] = Napi::String::New(env, "postgres");
    exports["language"] = pg_language;

    return exports;
}

NODE_API_MODULE(tree_sitter_postgres_binding, Init)
