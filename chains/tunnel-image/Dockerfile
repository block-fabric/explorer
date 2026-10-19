# The SSH tunnel to the testnet nodes (chains/tunnel.sh) as a service of the explorers' stack: it restarts with Docker.
# Runs as uid 1000 so that the mounted ~/.ssh (owned by that user, mode 600) is accepted by ssh.
FROM alpine:3.20
RUN apk add --no-cache bash openssh-client diffutils && adduser -D -u 1000 -h /home/tunnel tunnel
USER 1000
WORKDIR /home/tunnel
ENTRYPOINT ["bash", "/tunnel/tunnel.sh"]
