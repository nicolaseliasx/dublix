FROM ghcr.io/viren070/aiostreams:v2.37.0@sha256:bcfd8580695a50c8f464578a0e25af065f3bd17eac35ed82a733a18342ca9718
COPY portuguese-episodes.mjs patch-title.mjs library-title-aliases.mjs patch-library.mjs patch-title-filter.mjs stream-title.mjs /app/dublix/
RUN ["/nodejs/bin/node", "/app/dublix/patch-title.mjs", "--apply"]
RUN ["/nodejs/bin/node", "/app/dublix/patch-library.mjs", "--apply"]
RUN ["/nodejs/bin/node", "/app/dublix/patch-title-filter.mjs", "--apply"]
