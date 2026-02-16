"use client";

import { ApolloClient, InMemoryCache, HttpLink } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { setContext } from "@apollo/client/link/context";
import { useMemo } from "react";

function makeClient() {
  const httpLink = new HttpLink({
    uri: process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/graphql",
  });

  const authLink = setContext((_, { headers }) => ({
    headers: {
      ...headers,
      authorization: localStorage.getItem("workshopApiKey")
        ? `Bearer ${localStorage.getItem("workshopApiKey")}`
        : "",
      "x-user-id": localStorage.getItem("workshopUserId") || "",
    },
  }));

  return new ApolloClient({
    cache: new InMemoryCache(),
    link: authLink.concat(httpLink),
  });
}

export function ApolloWrapper({ children }: React.PropsWithChildren) {
  const client = useMemo(() => makeClient(), []);
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
