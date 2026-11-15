# Draftloom

Draftloom transforms annotated hand sketches into editable, structured 2D and
3D spatial designs. It is being built for HackUTA 2026 as a desktop-first web
application.

The core demo flow is:

> paper sketch -> interpreted objects -> verifiable geometry -> synchronized
> 2D/3D editing -> layout assistance -> Blender-compatible export

Draftloom is not an image generator or a certified architectural tool. Its
goal is to preserve meaningful objects, dimensions, and relationships so users
can inspect and revise the reconstructed scene.

## Project status

The shared frontend foundation and editor core are working. The repository now
includes the canonical scene contract, a validated sample scene, synchronized
2D/3D editing, packing, browser persistence, and native/SVG/GLB export.

The next implementation phase is Developer B's reconstruction work: the
Express API, laptop/phone photo import, QR upload sessions, and conversion of
annotated sketches into the same canonical `SceneDocument`.

The P0 target includes:

- A React, TypeScript, and Vite desktop interface backed by one Node/Express API
- Persistent, synchronized SVG-based 2D and Three.js-based 3D workspaces
- A canonical, serializable scene model shared by editing, rendering, saving,
  reconstruction, optimization, and export
- Laptop image import and account-free QR phone upload
- Review and correction of reconstructed walls, objects, dimensions, and
  uncertain geometry
- Manual editing that remains available when AI reconstruction is unavailable
- Local autosave, portable `.draftloom.json` projects, SVG export, and GLB
  export for Blender
- Deterministic arrange-in-region assistance with spacing and collision checks

## Technical foundation

| Area | Initial choice |
| --- | --- |
| Frontend | React, TypeScript, Vite, plain CSS |
| 2D editor | Native SVG and Pointer Events |
| 3D workspace | Three.js and official addons |
| API | Node.js 22+ and Express |
| Persistence | IndexedDB plus portable JSON export |
| Reconstruction | Server-side multimodal provider adapter with validated output |
| 3D export | Three.js `GLTFExporter` producing `.glb` files |

Runtime dependencies should remain small and versions must be pinned in
`package-lock.json`. API keys and other secrets belong only in server-side
environment variables and must never be committed.

## Architecture principles

- The native `SceneDocument` is the source of truth. SVG, Three.js objects, and
  glTF are derived views or exports.
- Geometry uses meters in a right-handed, Y-up world. The plan editor works on
  the X/Z ground plane.
- Box positions use a bottom-center anchor so resizing height preserves ground
  contact.
- The 2D and 3D workspaces stay mounted across view changes and share one scene
  store and selection state.
- Reconstruction produces editable scene data with provenance and warnings,
  never a flattened screenshot or opaque replacement schema.
- Reconstruction responses use `contractVersion: 1`; the native scene retains
  its independent `schemaVersion: 1` for project-file migrations.
- AI failure must not prevent manual creation, editing, saving, or export.

## Planned repository layout

```text
draftloom/
  src/
    app/       # application shell and state orchestration
    editor/    # 2D/3D workspaces, tools, inspector, optimizer
    scene/     # canonical schema, validation, and scene operations
    export/    # native JSON, SVG, and GLB export
    import/    # reconstruction client and import review
    shared/    # frozen cross-team contracts
  server/
    api/       # HTTP routes
    ai/        # provider adapters, prompts, and response validation
    upload/    # temporary phone-upload sessions
  samples/     # deterministic sketches and scene fixtures
  tests/
  public/
```

Planning and handoff documents are kept locally in `docs/`. That directory is
intentionally ignored by Git; the public implementation contract should be
reflected in source types, tests, and this README as the project evolves.

## Development

Node.js 22 or newer is required. Install the exact locked dependencies and
start the frontend from PowerShell:

```powershell
npm.cmd ci
npm.cmd run dev
```

Vite serves the app at `http://localhost:5173` and proxies `/api` to
`http://localhost:3001`. The API target can be changed with
`DRAFTLOOM_API_URL`; this is a server address, not a credential.

Current verification and production-frontend commands are:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

Developer B will add `npm run server:dev` and `npm start` with the Express
server so development uses the Vite proxy and production serves the built app
and `/api` from one origin.

No API key is needed to run the editor. Keep real credentials only in an
ignored local `.env` file and never use a `VITE_*` variable for a secret,
because Vite exposes those values to browser code. A future `.env.example`
must contain names and safe placeholders only.

## Collaboration boundaries

The editor side owns `src/app`, `src/editor`, `src/scene`, `src/export`, and the
shared build shell. The reconstruction side owns `src/import`, `server`, and
its image fixtures. Shared scene and reconstruction contracts must be changed
by agreement rather than duplicated in either area.

Work should land through small feature branches and pass type checking and
tests before integration. Any change to scene types, routes, coordinate
conventions, or ownership boundaries is an architecture change and should be
coordinated first.
