# @tangent/trees-store-sqlite Architecture

SQLite is an optional projection/index layer. The event log remains canonical, and core never imports this package.
