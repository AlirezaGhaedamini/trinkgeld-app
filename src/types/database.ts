export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_member_id: string | null
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: number
          reason: string | null
          record_id: string
          table_name: string
          workplace_id: string
        }
        Insert: {
          action: string
          actor_member_id?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: never
          reason?: string | null
          record_id: string
          table_name: string
          workplace_id: string
        }
        Update: {
          action?: string
          actor_member_id?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: never
          reason?: string | null
          record_id?: string
          table_name?: string
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_payouts: {
        Row: {
          id: string
          workplace_id: string
          distribution_id: string
          entitlement_cents: number
          previous_entitlement_cents: number
          amount_cents: number
          method: Database["public"]["Enums"]["payout_method"] | null
          note: string | null
          paid_at: string
          paid_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workplace_id: string
          distribution_id: string
          entitlement_cents: number
          previous_entitlement_cents: number
          amount_cents: number
          method?: Database["public"]["Enums"]["payout_method"] | null
          note?: string | null
          paid_at?: string
          paid_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workplace_id?: string
          distribution_id?: string
          entitlement_cents?: number
          previous_entitlement_cents?: number
          amount_cents?: number
          method?: Database["public"]["Enums"]["payout_method"] | null
          note?: string | null
          paid_at?: string
          paid_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      distribution_queries: {
        Row: {
          created_at: string
          distribution_id: string
          id: string
          manager_response: string | null
          member_id: string
          member_name: string
          note: string
          outcome: Database["public"]["Enums"]["query_outcome"] | null
          raised_at: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["query_status"]
          workplace_id: string
        }
        Insert: {
          created_at?: string
          distribution_id: string
          id?: string
          manager_response?: string | null
          member_id: string
          member_name: string
          note: string
          outcome?: Database["public"]["Enums"]["query_outcome"] | null
          raised_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["query_status"]
          workplace_id: string
        }
        Update: {
          created_at?: string
          distribution_id?: string
          id?: string
          manager_response?: string | null
          member_id?: string
          member_name?: string
          note?: string
          outcome?: Database["public"]["Enums"]["query_outcome"] | null
          raised_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["query_status"]
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_queries_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "member_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_queries_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "tip_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_queries_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_queries_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_queries_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_rule_areas: {
        Row: {
          area_id: string
          area_key: string
          id: string
          percentage: number
          rule_id: string
          workplace_id: string
        }
        Insert: {
          area_id: string
          area_key: string
          id?: string
          percentage?: number
          rule_id: string
          workplace_id: string
        }
        Update: {
          area_id?: string
          area_key?: string
          id?: string
          percentage?: number
          rule_id?: string
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_rule_areas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "workplace_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_rule_areas_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "distribution_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_rule_areas_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_rule_roles: {
        Row: {
          id: string
          points: number
          role_key: string
          rule_id: string
          workplace_id: string
          workplace_role_id: string
        }
        Insert: {
          id?: string
          points?: number
          role_key: string
          rule_id: string
          workplace_id: string
          workplace_role_id: string
        }
        Update: {
          id?: string
          points?: number
          role_key?: string
          rule_id?: string
          workplace_id?: string
          workplace_role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_rule_roles_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "distribution_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_rule_roles_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_rule_roles_workplace_role_id_fkey"
            columns: ["workplace_role_id"]
            isOneToOne: false
            referencedRelation: "workplace_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_rules: {
        Row: {
          acknowledgement_required: boolean
          activated_by: string | null
          adopted_by: Database["public"]["Enums"]["rule_adopted_by"] | null
          agreement_date: string | null
          agreement_reference: string | null
          created_at: string
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          method: Database["public"]["Enums"]["rule_method"]
          min_overlap_minutes: number
          note: string | null
          overlap_basis: Database["public"]["Enums"]["overlap_basis"]
          rounding_area_id: string | null
          service_window_end: string | null
          service_window_start: string | null
          status: Database["public"]["Enums"]["rule_status"]
          version: number | null
          workplace_id: string
        }
        Insert: {
          acknowledgement_required?: boolean
          activated_by?: string | null
          adopted_by?: Database["public"]["Enums"]["rule_adopted_by"] | null
          agreement_date?: string | null
          agreement_reference?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          method?: Database["public"]["Enums"]["rule_method"]
          min_overlap_minutes?: number
          note?: string | null
          overlap_basis?: Database["public"]["Enums"]["overlap_basis"]
          rounding_area_id?: string | null
          service_window_end?: string | null
          service_window_start?: string | null
          status?: Database["public"]["Enums"]["rule_status"]
          version?: number | null
          workplace_id: string
        }
        Update: {
          acknowledgement_required?: boolean
          activated_by?: string | null
          adopted_by?: Database["public"]["Enums"]["rule_adopted_by"] | null
          agreement_date?: string | null
          agreement_reference?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          method?: Database["public"]["Enums"]["rule_method"]
          min_overlap_minutes?: number
          note?: string | null
          overlap_basis?: Database["public"]["Enums"]["overlap_basis"]
          rounding_area_id?: string | null
          service_window_end?: string | null
          service_window_start?: string | null
          status?: Database["public"]["Enums"]["rule_status"]
          version?: number | null
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_rules_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_rules_rounding_area_id_fkey"
            columns: ["rounding_area_id"]
            isOneToOne: false
            referencedRelation: "workplace_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_rules_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string | null
          kind: Database["public"]["Enums"]["invitation_kind"]
          member_id: string | null
          proposed_area_id: string | null
          proposed_role: Database["public"]["Enums"]["member_role"]
          requested_by: string | null
          revoked_at: string | null
          status: Database["public"]["Enums"]["invitation_status"]
          token_hash: string | null
          workplace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          kind?: Database["public"]["Enums"]["invitation_kind"]
          member_id?: string | null
          proposed_area_id?: string | null
          proposed_role?: Database["public"]["Enums"]["member_role"]
          requested_by?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash?: string | null
          workplace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          kind?: Database["public"]["Enums"]["invitation_kind"]
          member_id?: string | null
          proposed_area_id?: string | null
          proposed_role?: Database["public"]["Enums"]["member_role"]
          requested_by?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash?: string | null
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_proposed_area_id_fkey"
            columns: ["proposed_area_id"]
            isOneToOne: false
            referencedRelation: "workplace_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_workplace_id: string | null
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          last_workplace_id?: string | null
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_workplace_id?: string | null
          locale?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_workplace_id_fkey"
            columns: ["last_workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          area_id: string | null
          break_minutes: number
          created_at: string
          created_by: string | null
          during: unknown
          ends_at: string
          id: string
          locked: boolean
          member_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: Database["public"]["Enums"]["shift_source"]
          starts_at: string
          status: Database["public"]["Enums"]["shift_status"]
          submitted_at: string | null
          updated_at: string
          work_date: string
          worked_minutes: number | null
          workplace_id: string
          workplace_role_id: string | null
        }
        Insert: {
          area_id?: string | null
          break_minutes?: number
          created_at?: string
          created_by?: string | null
          during?: unknown
          ends_at: string
          id?: string
          locked?: boolean
          member_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: Database["public"]["Enums"]["shift_source"]
          starts_at: string
          status?: Database["public"]["Enums"]["shift_status"]
          submitted_at?: string | null
          updated_at?: string
          work_date: string
          worked_minutes?: number | null
          workplace_id: string
          workplace_role_id?: string | null
        }
        Update: {
          area_id?: string | null
          break_minutes?: number
          created_at?: string
          created_by?: string | null
          during?: unknown
          ends_at?: string
          id?: string
          locked?: boolean
          member_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: Database["public"]["Enums"]["shift_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["shift_status"]
          submitted_at?: string | null
          updated_at?: string
          work_date?: string
          worked_minutes?: number | null
          workplace_id?: string
          workplace_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "workplace_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_workplace_role_id_fkey"
            columns: ["workplace_role_id"]
            isOneToOne: false
            referencedRelation: "workplace_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_distribution_areas: {
        Row: {
          area_id: string
          area_key: string
          area_name: string
          distribution_id: string
          id: string
          people_count: number
          percentage: number
          total_cents: number
          units: number
          workplace_id: string
        }
        Insert: {
          area_id: string
          area_key: string
          area_name: string
          distribution_id: string
          id?: string
          people_count?: number
          percentage: number
          total_cents?: number
          units?: number
          workplace_id: string
        }
        Update: {
          area_id?: string
          area_key?: string
          area_name?: string
          distribution_id?: string
          id?: string
          people_count?: number
          percentage?: number
          total_cents?: number
          units?: number
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_distribution_areas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "workplace_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_areas_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "member_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_areas_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "tip_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_areas_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_distribution_entries: {
        Row: {
          ack_status: Database["public"]["Enums"]["entry_ack_status"]
          acknowledged_at: string | null
          amount_cents: number
          area_id: string
          area_key: string
          area_name: string
          area_source: Database["public"]["Enums"]["area_source"]
          created_at: string
          distribution_id: string
          id: string
          member_id: string
          member_name: string
          multiplier: number
          overlap_minutes: number
          points: number
          queried_at: string | null
          query_note: string | null
          role_key: string | null
          role_name: string | null
          rounding_adjustment_cents: number
          shift_ids: string[]
          units: number
          worked_minutes: number
          workplace_id: string
        }
        Insert: {
          ack_status?: Database["public"]["Enums"]["entry_ack_status"]
          acknowledged_at?: string | null
          amount_cents?: number
          area_id: string
          area_key: string
          area_name: string
          area_source?: Database["public"]["Enums"]["area_source"]
          created_at?: string
          distribution_id: string
          id?: string
          member_id: string
          member_name: string
          multiplier?: number
          overlap_minutes?: number
          points?: number
          queried_at?: string | null
          query_note?: string | null
          role_key?: string | null
          role_name?: string | null
          rounding_adjustment_cents?: number
          shift_ids?: string[]
          units?: number
          worked_minutes?: number
          workplace_id: string
        }
        Update: {
          ack_status?: Database["public"]["Enums"]["entry_ack_status"]
          acknowledged_at?: string | null
          amount_cents?: number
          area_id?: string
          area_key?: string
          area_name?: string
          area_source?: Database["public"]["Enums"]["area_source"]
          created_at?: string
          distribution_id?: string
          id?: string
          member_id?: string
          member_name?: string
          multiplier?: number
          overlap_minutes?: number
          points?: number
          queried_at?: string | null
          query_note?: string | null
          role_key?: string | null
          role_name?: string | null
          rounding_adjustment_cents?: number
          shift_ids?: string[]
          units?: number
          worked_minutes?: number
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_distribution_entries_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "workplace_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_entries_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "member_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_entries_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "tip_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_entries_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_entries_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_distributions: {
        Row: {
          calculated_at: string
          calculated_by: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          correction_note: string | null
          correction_reason:
            | Database["public"]["Enums"]["correction_reason"]
            | null
          created_at: string
          engine_version: string
          entries_total_cents: number
          id: string
          initiated_at: string | null
          initiated_by: string | null
          inputs_fingerprint: string | null
          inputs_snapshot: Json
          method: Database["public"]["Enums"]["rule_method"]
          min_overlap_minutes: number
          overlap_basis: Database["public"]["Enums"]["overlap_basis"]
          people_count: number
          period_end: string
          period_start: string
          pool_cents: number
          rule_id: string
          rule_version: number
          rules_snapshot: Json
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["distribution_status"]
          supersedes_id: string | null
          tip_pool_id: string
          trigger_query_id: string | null
          workplace_id: string
        }
        Insert: {
          calculated_at?: string
          calculated_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmed_at?: string | null
          correction_note?: string | null
          correction_reason?:
            | Database["public"]["Enums"]["correction_reason"]
            | null
          created_at?: string
          engine_version: string
          entries_total_cents?: number
          id?: string
          initiated_at?: string | null
          initiated_by?: string | null
          inputs_fingerprint?: string | null
          inputs_snapshot: Json
          method: Database["public"]["Enums"]["rule_method"]
          min_overlap_minutes: number
          overlap_basis: Database["public"]["Enums"]["overlap_basis"]
          people_count?: number
          period_end: string
          period_start: string
          pool_cents: number
          rule_id: string
          rule_version: number
          rules_snapshot: Json
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["distribution_status"]
          supersedes_id?: string | null
          tip_pool_id: string
          trigger_query_id?: string | null
          workplace_id: string
        }
        Update: {
          calculated_at?: string
          calculated_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmed_at?: string | null
          correction_note?: string | null
          correction_reason?:
            | Database["public"]["Enums"]["correction_reason"]
            | null
          created_at?: string
          engine_version?: string
          entries_total_cents?: number
          id?: string
          initiated_at?: string | null
          initiated_by?: string | null
          inputs_fingerprint?: string | null
          inputs_snapshot?: Json
          method?: Database["public"]["Enums"]["rule_method"]
          min_overlap_minutes?: number
          overlap_basis?: Database["public"]["Enums"]["overlap_basis"]
          people_count?: number
          period_end?: string
          period_start?: string
          pool_cents?: number
          rule_id?: string
          rule_version?: number
          rules_snapshot?: Json
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["distribution_status"]
          supersedes_id?: string | null
          tip_pool_id?: string
          trigger_query_id?: string | null
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_distributions_calculated_by_fkey"
            columns: ["calculated_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "distribution_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "member_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "tip_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_tip_pool_id_fkey"
            columns: ["tip_pool_id"]
            isOneToOne: false
            referencedRelation: "tip_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_trigger_query_id_fkey"
            columns: ["trigger_query_id"]
            isOneToOne: false
            referencedRelation: "distribution_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_pool_sources: {
        Row: {
          card_cents: number
          cash_cents: number
          created_at: string
          pool_id: string
          tip_report_id: string
          workplace_id: string
        }
        Insert: {
          card_cents: number
          cash_cents: number
          created_at?: string
          pool_id: string
          tip_report_id: string
          workplace_id: string
        }
        Update: {
          card_cents?: number
          cash_cents?: number
          created_at?: string
          pool_id?: string
          tip_report_id?: string
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_pool_sources_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "tip_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_pool_sources_tip_report_id_fkey"
            columns: ["tip_report_id"]
            isOneToOne: false
            referencedRelation: "tip_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_pool_sources_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_pools: {
        Row: {
          card_cents: number
          cash_cents: number
          created_at: string
          created_by: string | null
          id: string
          label: string
          locked_at: string | null
          note: string | null
          period: Database["public"]["Enums"]["pool_period"]
          period_end: string
          period_start: string
          source: string
          status: Database["public"]["Enums"]["pool_status"]
          total_cents: number | null
          updated_at: string
          workplace_id: string
        }
        Insert: {
          card_cents?: number
          cash_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          locked_at?: string | null
          note?: string | null
          period?: Database["public"]["Enums"]["pool_period"]
          period_end: string
          period_start: string
          source?: string
          status?: Database["public"]["Enums"]["pool_status"]
          total_cents?: number | null
          updated_at?: string
          workplace_id: string
        }
        Update: {
          card_cents?: number
          cash_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          locked_at?: string | null
          note?: string | null
          period?: Database["public"]["Enums"]["pool_period"]
          period_end?: string
          period_start?: string
          source?: string
          status?: Database["public"]["Enums"]["pool_status"]
          total_cents?: number | null
          updated_at?: string
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_pools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_pools_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_reports: {
        Row: {
          card_cents: number
          cash_cents: number
          created_at: string
          id: string
          member_id: string
          note: string | null
          reported_at: string
          total_cents: number | null
          updated_at: string
          work_date: string
          workplace_id: string
        }
        Insert: {
          card_cents?: number
          cash_cents?: number
          created_at?: string
          id?: string
          member_id: string
          note?: string | null
          reported_at?: string
          total_cents?: number | null
          updated_at?: string
          work_date: string
          workplace_id: string
        }
        Update: {
          card_cents?: number
          cash_cents?: number
          created_at?: string
          id?: string
          member_id?: string
          note?: string | null
          reported_at?: string
          total_cents?: number | null
          updated_at?: string
          work_date?: string
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_reports_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_reports_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workplace_areas: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_pool_eligible: boolean
          key: string
          name: string
          sort_order: number
          updated_at: string
          workplace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_pool_eligible?: boolean
          key: string
          name: string
          sort_order?: number
          updated_at?: string
          workplace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_pool_eligible?: boolean
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workplace_areas_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workplace_members: {
        Row: {
          area_id: string | null
          created_at: string
          display_name: string
          employee_number: string | null
          id: string
          joined_at: string | null
          left_at: string | null
          multiplier: number
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string | null
          workplace_id: string
          workplace_role_id: string | null
        }
        Insert: {
          area_id?: string | null
          created_at?: string
          display_name: string
          employee_number?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          multiplier?: number
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
          workplace_id: string
          workplace_role_id?: string | null
        }
        Update: {
          area_id?: string | null
          created_at?: string
          display_name?: string
          employee_number?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          multiplier?: number
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
          workplace_id?: string
          workplace_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workplace_members_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "workplace_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workplace_members_role_id_fkey"
            columns: ["workplace_role_id"]
            isOneToOne: false
            referencedRelation: "workplace_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workplace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workplace_members_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workplace_roles: {
        Row: {
          archived_at: string | null
          area_id: string
          created_at: string
          id: string
          key: string
          name: string
          points: number
          sort_order: number
          updated_at: string
          workplace_id: string
        }
        Insert: {
          archived_at?: string | null
          area_id: string
          created_at?: string
          id?: string
          key: string
          name: string
          points?: number
          sort_order?: number
          updated_at?: string
          workplace_id: string
        }
        Update: {
          archived_at?: string | null
          area_id?: string
          created_at?: string
          id?: string
          key?: string
          name?: string
          points?: number
          sort_order?: number
          updated_at?: string
          workplace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workplace_roles_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "workplace_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workplace_roles_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workplaces: {
        Row: {
          archived_at: string | null
          business_day_start_hour: number
          city: string | null
          country_code: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          join_code: string | null
          join_code_enabled: boolean
          name: string
          peer_entry_visibility: Database["public"]["Enums"]["peer_visibility"]
          pool_amount_visible_to_members: boolean
          retention_years: number
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          business_day_start_hour?: number
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          join_code?: string | null
          join_code_enabled?: boolean
          name: string
          peer_entry_visibility?: Database["public"]["Enums"]["peer_visibility"]
          pool_amount_visible_to_members?: boolean
          retention_years?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          business_day_start_hour?: number
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          join_code?: string | null
          join_code_enabled?: boolean
          name?: string
          peer_entry_visibility?: Database["public"]["Enums"]["peer_visibility"]
          pool_amount_visible_to_members?: boolean
          retention_years?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workplaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      member_distribution_entries: {
        Row: {
          ack_status: Database["public"]["Enums"]["entry_ack_status"] | null
          acknowledged_at: string | null
          amount_cents: number | null
          area_id: string | null
          area_key: string | null
          area_name: string | null
          area_source: Database["public"]["Enums"]["area_source"] | null
          distribution_id: string | null
          id: string | null
          is_own: boolean | null
          member_id: string | null
          member_name: string | null
          multiplier: number | null
          overlap_minutes: number | null
          points: number | null
          queried_at: string | null
          query_note: string | null
          role_key: string | null
          role_name: string | null
          rounding_adjustment_cents: number | null
          units: number | null
          worked_minutes: number | null
          workplace_id: string | null
        }
        Insert: {
          ack_status?: Database["public"]["Enums"]["entry_ack_status"] | null
          acknowledged_at?: string | null
          amount_cents?: number | null
          area_id?: string | null
          area_key?: string | null
          area_name?: string | null
          area_source?: Database["public"]["Enums"]["area_source"] | null
          distribution_id?: string | null
          id?: string | null
          is_own?: never
          member_id?: string | null
          member_name?: string | null
          multiplier?: number | null
          overlap_minutes?: number | null
          points?: number | null
          queried_at?: string | null
          query_note?: string | null
          role_key?: string | null
          role_name?: string | null
          rounding_adjustment_cents?: number | null
          units?: number | null
          worked_minutes?: number | null
          workplace_id?: string | null
        }
        Update: {
          ack_status?: Database["public"]["Enums"]["entry_ack_status"] | null
          acknowledged_at?: string | null
          amount_cents?: number | null
          area_id?: string | null
          area_key?: string | null
          area_name?: string | null
          area_source?: Database["public"]["Enums"]["area_source"] | null
          distribution_id?: string | null
          id?: string | null
          is_own?: never
          member_id?: string | null
          member_name?: string | null
          multiplier?: number | null
          overlap_minutes?: number | null
          points?: number | null
          queried_at?: string | null
          query_note?: string | null
          role_key?: string | null
          role_name?: string | null
          rounding_adjustment_cents?: number | null
          units?: number | null
          worked_minutes?: number | null
          workplace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_distribution_entries_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "workplace_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_entries_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "member_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_entries_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "tip_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_entries_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workplace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distribution_entries_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_settlement: {
        Row: {
          distribution_id: string | null
          workplace_id: string | null
          status: Database["public"]["Enums"]["distribution_status"] | null
          supersedes_id: string | null
          entitlement_cents: number | null
          settled_entitlement_cents: number | null
          settlement_due_cents: number | null
          payout_status: Database["public"]["Enums"]["payout_status"] | null
          payout_id: string | null
          payout_amount_cents: number | null
          payout_method: Database["public"]["Enums"]["payout_method"] | null
          payout_note: string | null
          paid_at: string | null
          paid_by: string | null
          paid_by_name: string | null
        }
        Relationships: []
      }
      distribution_member_settlement: {
        Row: {
          distribution_id: string | null
          workplace_id: string | null
          member_id: string | null
          member_name: string | null
          entitlement_cents: number | null
          previously_settled_cents: number | null
          difference_cents: number | null
        }
        Relationships: []
      }
      member_distributions: {
        Row: {
          acknowledgement_required: boolean | null
          confirmed_at: string | null
          correction_note: string | null
          correction_reason:
            | Database["public"]["Enums"]["correction_reason"]
            | null
          id: string | null
          method: Database["public"]["Enums"]["rule_method"] | null
          min_overlap_minutes: number | null
          people_count: number | null
          period_end: string | null
          period_start: string | null
          pool_amount_visible: boolean | null
          pool_cents: number | null
          rule_version: number | null
          sent_at: string | null
          status: Database["public"]["Enums"]["distribution_status"] | null
          superseded_by: string | null
          supersedes_id: string | null
          payout_status: Database["public"]["Enums"]["payout_status"] | null
          payout_method: Database["public"]["Enums"]["payout_method"] | null
          paid_at: string | null
          settled_basis_id: string | null
          workplace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_distributions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "member_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "tip_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_workplace_id_fkey"
            columns: ["workplace_id"]
            isOneToOne: false
            referencedRelation: "workplaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      acknowledge_distribution: {
        Args: {
          p_distribution_id: string
          p_note?: string
          p_status: Database["public"]["Enums"]["entry_ack_status"]
        }
        Returns: number
      }
      acknowledge_entry: {
        Args: {
          p_entry_id: string
          p_note?: string
          p_status: Database["public"]["Enums"]["entry_ack_status"]
        }
        Returns: undefined
      }
      activate_rule: { Args: { p_rule_id: string }; Returns: number }
      approve_join_request: {
        Args: {
          p_area_id?: string
          p_display_name?: string
          p_invitation_id: string
          p_workplace_role_id?: string
        }
        Returns: string
      }
      archive_workplace_area: { Args: { p_area_id: string }; Returns: Json }
      archive_workplace_role: { Args: { p_role_id: string }; Returns: Json }
      area_usage: { Args: { p_area_id: string }; Returns: Json }
      calculate_distribution: { Args: { p_pool_id: string }; Returns: string }
      cancel_distribution: {
        Args: { p_distribution_id: string; p_reason: string }
        Returns: undefined
      }
      create_invitation: {
        Args: {
          p_area_id?: string
          p_display_name: string
          p_email: string
          p_role?: Database["public"]["Enums"]["member_role"]
          p_workplace_id: string
          p_workplace_role_id?: string
        }
        Returns: {
          invitation_id: string
          token: string
        }[]
      }
      create_pool_from_reports: {
        Args: {
          p_label?: string
          p_period_end: string
          p_period_start: string
          p_workplace_id: string
        }
        Returns: string
      }
      record_distribution_payout: {
        Args: {
          p_distribution_id: string
          p_method?: Database["public"]["Enums"]["payout_method"] | null
          p_note?: string | null
        }
        Returns: string
      }
      create_replacement_distribution: {
        Args: {
          p_note?: string
          p_original_id: string
          p_reason?: Database["public"]["Enums"]["correction_reason"]
        }
        Returns: string
      }
      create_rule_draft: { Args: { p_workplace_id: string }; Returns: string }
      create_workplace: {
        Args: {
          p_city?: string
          p_country_code?: string
          p_currency?: string
          p_display_name?: string
          p_name: string
          p_timezone?: string
        }
        Returns: string
      }
      create_workplace_area: {
        Args: {
          p_name: string
          p_pool_eligible?: boolean
          p_workplace_id: string
        }
        Returns: string
      }
      create_workplace_role: {
        Args: {
          p_area_id: string
          p_name: string
          p_points?: number
          p_workplace_id: string
        }
        Returns: string
      }
      distribution_ack_state: {
        Args: { p_distribution_id: string }
        Returns: {
          ack_status: Database["public"]["Enums"]["entry_ack_status"]
          acknowledged_at: string
          area_name: string
          can_acknowledge: boolean
          entry_id: string
          member_id: string
          member_name: string
          queried_at: string
        }[]
      }
      distribution_query_list: {
        Args: { p_distribution_id: string }
        Returns: {
          amount_cents: number
          manager_response: string
          member_id: string
          member_name: string
          note: string
          outcome: Database["public"]["Enums"]["query_outcome"]
          query_id: string
          raised_at: string
          resolved_at: string
          status: Database["public"]["Enums"]["query_status"]
        }[]
      }
      pending_join_requests: {
        Args: { p_workplace_id: string }
        Returns: {
          invitation_id: string
          proposed_area_id: string
          requested_at: string
          requester_name: string
        }[]
      }
      query_distribution: {
        Args: { p_distribution_id: string; p_note: string }
        Returns: number
      }
      reorder_workplace_areas: {
        Args: { p_ids: string[]; p_workplace_id: string }
        Returns: undefined
      }
      reorder_workplace_roles: {
        Args: { p_area_id: string; p_ids: string[] }
        Returns: undefined
      }
      request_join: { Args: { p_join_code: string }; Returns: string }
      resolve_query: {
        Args: {
          p_outcome: Database["public"]["Enums"]["query_outcome"]
          p_query_id: string
          p_response?: string
        }
        Returns: undefined
      }
      restore_workplace_area: {
        Args: { p_area_id: string }
        Returns: undefined
      }
      restore_workplace_role: {
        Args: { p_role_id: string }
        Returns: undefined
      }
      role_usage: { Args: { p_role_id: string }; Returns: Json }
      send_distribution: {
        Args: { p_distribution_id: string }
        Returns: undefined
      }
    }
    Enums: {
      area_source: "shift" | "member"
      correction_reason:
        | "hours"
        | "area"
        | "role"
        | "multiplier"
        | "tip_amount"
        | "rule"
        | "other"
      distribution_status: "draft" | "sent" | "confirmed" | "cancelled"
      entry_ack_status: "pending" | "acknowledged" | "queried"
      invitation_kind: "invite" | "join_request"
      invitation_status:
        | "pending"
        | "accepted"
        | "declined"
        | "revoked"
        | "expired"
      member_role: "manager" | "employee"
      member_status: "invited" | "active" | "suspended" | "left"
      overlap_basis: "longest_shift" | "pairwise" | "service_window"
      peer_visibility: "none" | "area" | "workplace"
      pool_period: "shift" | "day" | "week" | "custom"
      pool_status: "open" | "locked" | "distributed" | "void"
      query_outcome: "no_correction" | "correction_required"
      query_status: "open" | "resolved"
      payout_method: "cash" | "payroll" | "bank_transfer" | "other"
      payout_status: "unpaid" | "paid"
      rule_adopted_by: "employer" | "staff_agreement" | "works_council"
      rule_method: "hours_points" | "hours" | "equal"
      rule_status: "draft" | "active" | "superseded"
      shift_source: "employee" | "manager" | "import"
      shift_status: "draft" | "submitted" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      area_source: ["shift", "member"],
      correction_reason: [
        "hours",
        "area",
        "role",
        "multiplier",
        "tip_amount",
        "rule",
        "other",
      ],
      distribution_status: ["draft", "sent", "confirmed", "cancelled"],
      entry_ack_status: ["pending", "acknowledged", "queried"],
      invitation_kind: ["invite", "join_request"],
      invitation_status: [
        "pending",
        "accepted",
        "declined",
        "revoked",
        "expired",
      ],
      member_role: ["manager", "employee"],
      member_status: ["invited", "active", "suspended", "left"],
      overlap_basis: ["longest_shift", "pairwise", "service_window"],
      peer_visibility: ["none", "area", "workplace"],
      pool_period: ["shift", "day", "week", "custom"],
      pool_status: ["open", "locked", "distributed", "void"],
      query_outcome: ["no_correction", "correction_required"],
      query_status: ["open", "resolved"],
      rule_adopted_by: ["employer", "staff_agreement", "works_council"],
      rule_method: ["hours_points", "hours", "equal"],
      rule_status: ["draft", "active", "superseded"],
      shift_source: ["employee", "manager", "import"],
      shift_status: ["draft", "submitted", "approved", "rejected"],
    },
  },
} as const
