# UI Architecture

React and Vite live only in UI packages. Domain packages expose serializable APIs and UI-data packages convert those APIs into stable view models.

Local servers are framework-agnostic: products register API routes and pass compiled UI assets into `@tangent/ui-server`.
