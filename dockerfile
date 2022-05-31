# set deno as runtime environment
FROM denoland/deno:ubuntu

# expose port docker image will run on
EXPOSE 1993

# create and set working directory for docker image to hold all files within the docker image
WORKDIR /docker_redlock

# set default user so default isn't root
USER deno

# cache dependencies - only gets rerun when deps.ts is modified
# copies deps.ts from our local filetree into docker container working directory (.)
COPY deps.ts .
RUN deno cache deps.ts

# update files in working directory on file change
ADD . .

# Compile the main app starting at redlock.ts - everything else is imported/exported through it
RUN deno cache redlock.ts

# set command to run when docker image is started - "deno run --allow-net redlock.ts"
CMD ["run", "--allow-net", "redlock.ts"]
