# Context Router

A NestJS GraphQL monolith built with Prisma and PostgreSQL, designed with clean separation for easy microservice migration.

## Tech Stack

- **Framework**: NestJS
- **API**: GraphQL with Apollo Server
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Language**: TypeScript
- **Containerization**: Docker & Docker Compose

## Project Structure

```
src/
├── main.ts                      # Application bootstrap
├── app.module.ts                # Root module
├── config/                      # Configuration files
│   ├── app.config.ts
│   ├── database.config.ts
│   └── graphql.config.ts
├── common/                      # Shared utilities
│   ├── decorators/
│   ├── filters/
│   ├── interceptors/
│   ├── guards/
│   ├── pipes/
│   ├── exceptions/
│   └── utils/
├── infrastructure/              # Infrastructure layer
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── cache/
│   └── http/
├── graphql/                     # GraphQL-specific code
│   ├── scalars/
│   ├── plugins/
│   └── loaders/
└── modules/                     # Feature modules
    ├── user/
    │   ├── user.module.ts
    │   ├── user.service.ts
    │   ├── user.resolver.ts
    │   ├── user.repository.ts
    │   ├── dto/
    │   └── models/
    ├── auth/
    ├── health/
    └── system/
```

## Getting Started

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development without Docker)

### Running with Docker

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd context-router
   ```

2. **Copy environment variables**
   ```bash
   cp .env.example .env
   ```

3. **Start the application**
   ```bash
   docker-compose up -d
   ```

4. **Run Prisma migrations**
   ```bash
   docker-compose exec app npx prisma migrate dev --name init
   ```

5. **Seed the database (optional)**
   ```bash
   docker-compose exec app npm run prisma:seed
   ```

6. **Access the application**
   - API: http://localhost:3000
   - GraphQL Playground: http://localhost:3000/graphql
   - Health Check: http://localhost:3000/health

### Local Development (without Docker)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start PostgreSQL** (via Docker)
   ```bash
   docker-compose up postgres -d
   ```

3. **Run migrations**
   ```bash
   npm run prisma:migrate
   ```

4. **Start development server**
   ```bash
   npm run start:dev
   ```

## Available Scripts

- `npm run build` - Build the application
- `npm run start` - Start the application
- `npm run start:dev` - Start in development mode with watch
- `npm run start:prod` - Start in production mode
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio
- `npm run prisma:seed` - Seed the database

## GraphQL API

### Queries

```graphql
# Get all users
query {
  users {
    userId
    email
    firstName
    lastName
    createdAt
    updatedAt
  }
}

# Get a single user
query {
  user(id: "user-id-here") {
    userId
    email
    firstName
    lastName
  }
}
```

### Mutations

```graphql
# Create a user
mutation {
  createUser(createUserInput: {
    email: "john@example.com"
    firstName: "John"
    lastName: "Doe"
  }) {
    userId
    email
    firstName
    lastName
  }
}

# Update a user
mutation {
  updateUser(updateUserInput: {
    userId: "user-id-here"
    firstName: "Jane"
  }) {
    userId
    firstName
  }
}

# Delete a user
mutation {
  removeUser(id: "user-id-here") {
    userId
    email
  }
}
```

## Architecture Decisions

### Layered Architecture
- **Resolver**: GraphQL API layer
- **Service**: Business logic (stateless, testable)
- **Repository**: Data access abstraction (wraps Prisma)

### Microservice Ready
Each module is self-contained with clear boundaries:
- Domain logic isolated in services
- Data access abstracted in repositories
- GraphQL resolvers can be swapped for REST/gRPC

### Infrastructure Abstraction
Database and external dependencies are isolated in the infrastructure layer, making it easy to swap implementations.

## Docker Services

- **postgres**: PostgreSQL database (port 5432)
- **app**: NestJS application (port 3000)

## Environment Variables

See `.env.example` for all available configuration options.

## License

ISC