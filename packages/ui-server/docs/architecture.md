# @tangent/ui-server Architecture

The server accepts compiled UI assets, mounted product asset roots, and API route handlers. Product packages own their API routes; this package owns static serving, mounted asset prefix handling, health, errors, and optional browser opening.
