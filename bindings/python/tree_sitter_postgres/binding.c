#include <Python.h>

typedef struct TSLanguage TSLanguage;

TSLanguage *tree_sitter_postgres(void);
TSLanguage *tree_sitter_plpgsql(void);

static PyObject* _binding_language(PyObject *Py_UNUSED(self), PyObject *Py_UNUSED(args)) {
    return PyCapsule_New(tree_sitter_postgres(), "tree_sitter.Language", NULL);
}

static PyObject* _binding_language_plpgsql(PyObject *Py_UNUSED(self), PyObject *Py_UNUSED(args)) {
    return PyCapsule_New(tree_sitter_plpgsql(), "tree_sitter.Language", NULL);
}

static PyMethodDef methods[] = {
    {"language", _binding_language, METH_NOARGS,
     "Get the tree-sitter language for the PostgreSQL SQL grammar."},
    {"language_plpgsql", _binding_language_plpgsql, METH_NOARGS,
     "Get the tree-sitter language for the PL/pgSQL grammar."},
    {NULL, NULL, 0, NULL}
};

static struct PyModuleDef module = {
    .m_base = PyModuleDef_HEAD_INIT,
    .m_name = "_binding",
    .m_doc = NULL,
    .m_size = -1,
    .m_methods = methods
};

PyMODINIT_FUNC PyInit__binding(void) {
    return PyModule_Create(&module);
}
