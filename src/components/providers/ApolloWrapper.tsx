"use client";

import React, { ReactNode } from "react";
import { ApolloProvider } from "@apollo/client/react";
import { getClient } from "@/graphql/client";

export function ApolloWrapper({ children }: { children: ReactNode }) {
  const client = getClient();
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
