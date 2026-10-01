import { ApolloClient, InMemoryCache, HttpLink, split, from } from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { createClient } from "graphql-ws";
import { getMainDefinition } from "@apollo/client/utilities";

function createApolloClient() {
  const httpUri = process.env.NEXT_PUBLIC_GRAPHQL_URL || "/api/graphql";

  const httpLink = new HttpLink({
    uri: httpUri,
  });

  if (typeof window === "undefined") {
    return new ApolloClient({
      link: httpLink,
      cache: new InMemoryCache(),
      ssrMode: true,
    });
  }

  // Browser environment: configure WebSocket subscription link
  const loc = window.location;
  const defaultWsHost = loc.host;
  const defaultWsProtocol = loc.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl =
    process.env.NEXT_PUBLIC_GRAPHQL_WS_URL || `${defaultWsProtocol}//${defaultWsHost}/graphql`;

  const wsLink = new GraphQLWsLink(
    createClient({
      url: wsUrl,
      retryAttempts: 10,
      shouldRetry: () => true,
    })
  );

  const splitLink = split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return (
        definition.kind === "OperationDefinition" &&
        definition.operation === "subscription"
      );
    },
    wsLink,
    httpLink
  );

  return new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache(),
  });
}

let client: ApolloClient | null = null;

export function getClient(): ApolloClient {
  if (typeof window === "undefined") {
    return createApolloClient();
  }
  if (!client) {
    client = createApolloClient();
  }
  return client;
}
