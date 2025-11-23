// Shared GraphQL response types for the frontend

export interface User {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface MeQueryResponse {
  me: User;
}

export interface UpdateUserResponse {
  updateUser: User;
}
