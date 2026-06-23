FROM golang:1.22-alpine AS test

WORKDIR /src
COPY sdks/go ./sdks/go
COPY examples/gin-governed-crud ./examples/gin-governed-crud
WORKDIR /src/examples/gin-governed-crud
RUN go test ./...

FROM golang:1.22-alpine AS run

WORKDIR /src
COPY sdks/go ./sdks/go
COPY examples/gin-governed-crud ./examples/gin-governed-crud
WORKDIR /src/examples/gin-governed-crud
RUN go build -o /usr/local/bin/gin-governed-crud .

EXPOSE 8080
CMD ["gin-governed-crud"]
