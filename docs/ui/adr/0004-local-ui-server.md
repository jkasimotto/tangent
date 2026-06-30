# ADR 0004: Local UI Server

Decision: product servers use `@tangent/ui-server` to serve compiled assets and register local JSON routes.

Reason: static UI serving is shared infrastructure and should not be reimplemented inside each product.
