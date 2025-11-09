# Quick Start Guide

## What We Built

A production-ready NestJS GraphQL monolith with:
- **Clean Architecture**: Layered structure ready for microservices migration
- **GraphQL API**: Apollo Server with type-safe queries and mutations
- **Database**: PostgreSQL with Prisma ORM
- **Docker**: Fully containerized development environment
- **User Management**: Complete CRUD operations for users

## Quick Start

### 1. Start the Application

```bash
docker compose up -d
```

This starts:
- PostgreSQL database on port 5432
- NestJS application on port 3000

### 2. Run Migrations (First Time Only)

```bash
docker compose exec app npx prisma migrate dev --name init
```

### 3. Seed Database (Optional)

```bash
docker compose exec app npm run prisma:seed
```

## Access Points

- **Health Check**: http://localhost:3000/health
- **GraphQL Playground**: http://localhost:3000/graphql
- **API Endpoint**: http://localhost:3000/graphql (POST)

## Example GraphQL Operations

### Query All Users

```graphql
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
```

### Get Single User

```graphql
query {
  user(id: "user-id-here") {
    userId
    email
    firstName
    lastName
  }
}
```

### Create User

```graphql
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
```

### Update User

```graphql
mutation {
  updateUser(updateUserInput: {
    userId: "user-id-here"
    firstName: "Jane"
    email: "jane@example.com"
  }) {
    userId
    email
    firstName
    lastName
  }
}
```

### Delete User

```graphql
mutation {
  removeUser(id: "user-id-here") {
    userId
    email
  }
}
```

## Testing with cURL

Run the included test script:

```bash
./test-graphql.sh
```

Or manually:

```bash
# Query all users
curl http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ users { userId email firstName lastName } }"}'

# Create a user
curl http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation { createUser(createUserInput: { email: \"test@example.com\", firstName: \"Test\", lastName: \"User\" }) { userId email } }"}'
```

## Useful Commands

```bash
# View logs
docker compose logs -f app

# Stop all services
docker compose down

# Rebuild containers
docker compose build

# Access Prisma Studio (Database GUI)
docker compose exec app npx prisma studio

# Run migrations
docker compose exec app npx prisma migrate dev

# Generate Prisma Client
docker compose exec app npx prisma generate

# Access database directly
docker compose exec postgres psql -U postgres -d context_router
```

## Project Structure Highlights

```
src/
├── infrastructure/prisma/     # Database abstraction layer
├── modules/user/              # User domain (self-contained)
│   ├── user.repository.ts     # Data access layer
│   ├── user.service.ts        # Business logic
│   ├── user.resolver.ts       # GraphQL API
│   ├── dto/                   # Input validation
│   └── models/                # GraphQL types
├── config/                    # Configuration files
└── common/                    # Shared utilities
```

## Next Steps

1. **Add Authentication**: Implement auth module with JWT
2. **Add More Modules**: Create new feature modules following the user pattern
3. **Add Tests**: Write unit and e2e tests
4. **Add Validation**: Enhance DTOs with more validators
5. **Add Subscriptions**: Real-time updates with GraphQL subscriptions

## Microservice Migration Path

When ready to extract a module into a microservice:

1. Take the module folder (e.g., `modules/user/`)
2. Create a new NestJS project
3. Copy the module maintaining the same structure
4. Replace GraphQL resolver with REST/gRPC controller
5. Service and repository layers remain unchanged
6. Update the main app to call the microservice

The clean separation makes this process straightforward!
