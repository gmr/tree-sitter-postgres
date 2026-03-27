fn main() {
    let pg_src = std::path::Path::new("postgres/src");
    let plpgsql_src = std::path::Path::new("plpgsql/src");

    let mut c_config = cc::Build::new();
    c_config.std("c11").include(pg_src).include(plpgsql_src);

    #[cfg(target_env = "msvc")]
    c_config.flag("-utf-8");

    // postgres parser
    let parser_path = pg_src.join("parser.c");
    c_config.file(&parser_path);
    println!("cargo:rerun-if-changed={}", parser_path.to_str().unwrap());

    // plpgsql parser + external scanner
    let plpgsql_parser = plpgsql_src.join("parser.c");
    c_config.file(&plpgsql_parser);
    println!("cargo:rerun-if-changed={}", plpgsql_parser.to_str().unwrap());

    let plpgsql_scanner = plpgsql_src.join("scanner.c");
    c_config.file(&plpgsql_scanner);
    println!("cargo:rerun-if-changed={}", plpgsql_scanner.to_str().unwrap());

    c_config.compile("tree-sitter-postgres");
}
