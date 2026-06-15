# ADR 0003: Decide Against Native RPA Archive Support

## Status

Accepted

## Context

Ren'Py visual novel distributions often bundle game assets and scripts into
Ren'Py Archive (`.rpa`) container files. Supporting direct upload/import of
`.rpa` archives would streamline the visual novel auditing process.

A technical investigation was conducted to determine the feasibility and
architectural fit of adding native `.rpa` archive decompression and parsing in
the browser:

1. **RPA Container Parsing**: Parsing the `.rpa` header, seeking to the index
   offset, decompressing the index via native `DecompressionStream("deflate")`
   (zlib RFC 1950), deserializing the Python pickle index (using
   `pickleparser`), and deobfuscating the offsets using the header's XOR subkeys
   is fully feasible in a browser environment.
2. **The compiled script (`.rpyc`) constraint**: The flowchart viewer requires
   plain-text Ren'Py source script files (`.rpy`) to build the AST. In
   production distributions, developers compile `.rpy` scripts into compiled
   Python AST bytecode files (`.rpyc`) before packaging them into RPA archives.
   Native RPA support without a decompilation step would only yield compiled
   `.rpyc` bytes that the browser cannot parse.
3. **Decompilation Overhead**: Decompiling `.rpyc` to `.rpy` requires `unrpyc`,
   which is a complex Python-only tool. Running it in-browser would require a
   WebAssembly Python runtime (e.g. Pyodide), which adds ~10-20MB of network and
   execution overhead, severely degrading client-side performance and bundle
   size.

## Decision

We will **not** implement native in-browser RPA/RPYC extraction and
decompilation support.

Instead:

- The Flowchart Viewer will continue to focus on parsing plain-text `.rpy`
  script files.
- We will document pre-processing workflows in the README to guide users on
  using offline tools (`unrpa`/`rpatool` and `unrpyc`) to extract and decompile
  packaged archives locally before uploading the resulting folder to the viewer.

## Consequences

- The application bundle remains lightweight, fast, and secure.
- We avoid the security and performance risks associated with deserializing
  arbitrary Python pickle files and executing a Python runtime in WebAssembly.
- The user workflow for packaged visual novels is clearly defined as an offline
  pre-processing step.
