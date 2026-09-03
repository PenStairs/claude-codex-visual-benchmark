# Benchmark participant rules

Implement the requested scene in the existing scaffold.

- You may edit only `index.html`, `src/main.js`, and `src/style.css`.
- Do not edit `package.json`, `package-lock.json`, `AGENTS.md`, or `CLAUDE.md` (the last two are identical copies of these rules).
- Do not install packages, load remote assets, call network services, or read files outside this workspace.
- Use only the pinned `three` package and its official examples modules already available in `node_modules`.
- If the benchmark prompt requires a single HTML file, put the application HTML, CSS, and JavaScript in `index.html` and leave `src/main.js` and `src/style.css` unchanged.
- If the benchmark prompt names a Three.js CDN, treat it only as the dependency delivery mechanism: the benchmark may map recognized Three.js module CDN URLs to the pinned local package, while all other external requests remain blocked.
- Build all geometry, materials, textures, labels, and animation procedurally in code.
- Keep the page full-screen and runnable with `npm run build`.
- Finish by running `npm run build` and repairing any compile error you introduced.
