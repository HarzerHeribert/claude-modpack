# tally

tally is a small invoice service: it imports invoices from partners' CSV files into an sqlite database and serves them
over HTTP on port 8742.

    make init      # creates var/tally.db with its schema and the cache directory
    make run       # starts the server in the background (log: logs/server.log)
    make health    # asks the running server how it is
    make stop      # stops it
    make import    # imports data/incoming/*.csv (log: logs/import.log)
    make test

    curl http://localhost:8742/invoices?customer=acme

The configuration is config/service.toml. The cache lives in var/cache.
