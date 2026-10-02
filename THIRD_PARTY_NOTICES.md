# Third-party notices

WebMind is licensed under GPL-2.0-or-later. The complete license is in LICENSE.

- FreeMind: interoperability reference and file-format reference, GPL-2.0-or-later. https://freemind.sourceforge.io/ . No Java source or original icon bitmap is included in this implementation. WebMind is an independent project, not an official FreeMind release.
- Lucide React: ISC license, https://lucide.dev/ . Interface icons are supplied by lucide-react; preserve its package license when distributing dependencies.
- React / React DOM: MIT license, https://react.dev/ .
- Fastify and its plugins: MIT license, https://fastify.dev/ .
- Better Auth: MIT license, https://better-auth.com/ .
- better-sqlite3: MIT license; SQLite itself is public domain. https://github.com/WiseLibs/better-sqlite3 .
- @xmldom/xmldom: MIT license, https://github.com/xmldom/xmldom .
- DOMPurify: Apache-2.0 OR MPL-2.0, https://github.com/cure53/DOMPurify .
- fflate, idb-keyval, Zod: MIT licenses. Package metadata and licenses are retained in node_modules and the lockfile records exact versions.
- Nodemailer: MIT-0 license, https://nodemailer.com/ .
- Emoji and priority symbols are Unicode characters rendered using the user's system fonts; original FreeMind image assets are not bundled.

Before distributing a production image, retain the dependency license files and publish the corresponding WebMind source, package-lock.json, and build instructions. `npm ls --all` identifies the complete installed dependency tree.
