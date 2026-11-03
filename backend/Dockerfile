FROM maven:3.9-eclipse-temurin-21-alpine AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S cd4 && adduser -S cd4 -G cd4 && mkdir -p /data/uploads && chown -R cd4:cd4 /data
WORKDIR /app
COPY --from=build /build/target/cd4-backend-*.jar app.jar
USER cd4
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
