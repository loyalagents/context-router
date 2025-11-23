import { HttpLink, ApolloClient, InMemoryCache } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { registerApolloClient } from "@apollo/experimental-nextjs-app-support";

export const { getClient } = registerApolloClient(() => {
  const httpLink = new HttpLink({
    uri: process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/graphql",
  });

  const authLink = setContext((_, { headers }) => {
    return {
      headers: {
        ...headers,
      }
    };
  });

  return new ApolloClient({
    cache: new InMemoryCache(),
    link: authLink.concat(httpLink),
  });
});
