/**
 * Supabase client factory for integration tests.
 *
 * Provides:
 *  - getAdminClient()  — service_role client that bypasses RLS
 *  - getScopedClient() — anon-key client signed in as a specific user (subject to RLS)
 *  - createTestUser()  — creates a Supabase Auth user, returns UUID
 *  - getTestUser()     — retrieves a user by email, or null
 *  - deleteTestUser()  — removes a user by UUID
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ensureEnvVars } from "./constants";

// ---------------------------------------------------------------------------
// Admin Client (bypasses RLS via service_role key)
// ---------------------------------------------------------------------------

let adminClient: SupabaseClient | null = null;

/**
 * Returns a Supabase client initialized with the service_role key.
 * This client bypasses all Row Level Security policies and should only be
 * used for test setup, teardown, and verification queries.
 *
 * The client is lazily created and cached for the lifetime of the test process.
 */
export function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const { supabaseUrl, serviceRoleKey } = ensureEnvVars();

  adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return adminClient;
}

// ---------------------------------------------------------------------------
// Scoped Client (subject to RLS — authenticated as a specific test user)
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase client authenticated as the given user via
 * `auth.signInWithPassword`. This client uses the anon key and is fully
 * subject to Row Level Security policies.
 *
 * A new client instance is created on each call to avoid session leakage
 * between tests.
 */
export async function getScopedClient(
  email: string,
  password: string
): Promise<SupabaseClient> {
  const { supabaseUrl, anonKey } = ensureEnvVars();

  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(
      `Failed to sign in as ${email}: ${error.message}`
    );
  }

  return client;
}

// ---------------------------------------------------------------------------
// Test User Management
// ---------------------------------------------------------------------------

/**
 * Creates a new user in Supabase Auth using the admin client.
 * Returns the user's UUID.
 *
 * Throws if user creation fails (e.g., duplicate email).
 */
export async function createTestUser(
  email: string,
  password: string
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // auto-confirm so signInWithPassword works immediately
  });

  if (error) {
    throw new Error(
      `Failed to create test user ${email}: ${error.message}`
    );
  }

  return data.user.id;
}

/**
 * Retrieves a Supabase Auth user by email using the admin client.
 * Returns `{ id: string }` if found, or `null` if no user matches.
 */
export async function getTestUser(
  email: string
): Promise<{ id: string } | null> {
  const admin = getAdminClient();

  // Use listUsers with filter for more reliable lookup (avoids pagination issues)
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    throw new Error(
      `Failed to list users while looking up ${email}: ${error.message}`
    );
  }

  const user = data.users.find((u) => u.email === email);
  return user ? { id: user.id } : null;
}

/**
 * Deletes a Supabase Auth user by UUID using the admin client.
 * No-op if the user does not exist (Supabase returns success for missing IDs).
 */
export async function deleteTestUser(id: string): Promise<void> {
  const admin = getAdminClient();

  const { error } = await admin.auth.admin.deleteUser(id);

  if (error) {
    throw new Error(
      `Failed to delete test user ${id}: ${error.message}`
    );
  }
}
