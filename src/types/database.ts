export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.15';
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      cards: {
        Row: {
          created_at: string;
          deck_id: string;
          difficulty: number | null;
          due: string;
          elapsed_days: number;
          fsrs_state: Database['public']['Enums']['fsrs_state'];
          id: string;
          kind: Database['public']['Enums']['card_kind'];
          lapses: number;
          last_review: string | null;
          payload: Json;
          reps: number;
          scheduled_days: number;
          source_excerpt: string | null;
          stability: number | null;
          status: Database['public']['Enums']['card_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deck_id: string;
          difficulty?: number | null;
          due?: string;
          elapsed_days?: number;
          fsrs_state?: Database['public']['Enums']['fsrs_state'];
          id?: string;
          kind: Database['public']['Enums']['card_kind'];
          lapses?: number;
          last_review?: string | null;
          payload: Json;
          reps?: number;
          scheduled_days?: number;
          source_excerpt?: string | null;
          stability?: number | null;
          status?: Database['public']['Enums']['card_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          deck_id?: string;
          difficulty?: number | null;
          due?: string;
          elapsed_days?: number;
          fsrs_state?: Database['public']['Enums']['fsrs_state'];
          id?: string;
          kind?: Database['public']['Enums']['card_kind'];
          lapses?: number;
          last_review?: string | null;
          payload?: Json;
          reps?: number;
          scheduled_days?: number;
          source_excerpt?: string | null;
          stability?: number | null;
          status?: Database['public']['Enums']['card_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cards_deck_id_fkey';
            columns: ['deck_id'];
            isOneToOne: false;
            referencedRelation: 'decks';
            referencedColumns: ['id'];
          },
        ];
      };
      decks: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          new_cards_per_day: number;
          source: Database['public']['Enums']['gen_source'];
          status: Database['public']['Enums']['deck_status'];
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          new_cards_per_day?: number;
          source?: Database['public']['Enums']['gen_source'];
          status?: Database['public']['Enums']['deck_status'];
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          new_cards_per_day?: number;
          source?: Database['public']['Enums']['gen_source'];
          status?: Database['public']['Enums']['deck_status'];
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      generations: {
        Row: {
          cards_accepted: number | null;
          cards_requested: number;
          cards_returned: number;
          cost_usd: number | null;
          created_at: string;
          deck_id: string | null;
          error: string | null;
          finished_at: string | null;
          id: string;
          input_chars: number;
          input_tokens: number | null;
          model: string;
          output_tokens: number | null;
          prompt_version: string | null;
          source: Database['public']['Enums']['gen_source'];
          status: string;
          user_id: string;
        };
        Insert: {
          cards_accepted?: number | null;
          cards_requested: number;
          cards_returned?: number;
          cost_usd?: number | null;
          created_at?: string;
          deck_id?: string | null;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          input_chars: number;
          input_tokens?: number | null;
          model: string;
          output_tokens?: number | null;
          prompt_version?: string | null;
          source: Database['public']['Enums']['gen_source'];
          status?: string;
          user_id: string;
        };
        Update: {
          cards_accepted?: number | null;
          cards_requested?: number;
          cards_returned?: number;
          cost_usd?: number | null;
          created_at?: string;
          deck_id?: string | null;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          input_chars?: number;
          input_tokens?: number | null;
          model?: string;
          output_tokens?: number | null;
          prompt_version?: string | null;
          source?: Database['public']['Enums']['gen_source'];
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'generations_deck_id_fkey';
            columns: ['deck_id'];
            isOneToOne: false;
            referencedRelation: 'decks';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          daily_new_limit: number;
          display_name: string | null;
          fsrs_params: Json | null;
          id: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          daily_new_limit?: number;
          display_name?: string | null;
          fsrs_params?: Json | null;
          id: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          daily_new_limit?: number;
          display_name?: string | null;
          fsrs_params?: Json | null;
          id?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          card_id: string;
          difficulty_after: number | null;
          difficulty_before: number | null;
          duration_ms: number | null;
          elapsed_days: number;
          id: string;
          rating: number;
          reviewed_at: string;
          scheduled_days: number;
          stability_after: number | null;
          stability_before: number | null;
          state_after: Database['public']['Enums']['fsrs_state'];
          state_before: Database['public']['Enums']['fsrs_state'];
          user_id: string;
        };
        Insert: {
          card_id: string;
          difficulty_after?: number | null;
          difficulty_before?: number | null;
          duration_ms?: number | null;
          elapsed_days: number;
          id?: string;
          rating: number;
          reviewed_at?: string;
          scheduled_days: number;
          stability_after?: number | null;
          stability_before?: number | null;
          state_after: Database['public']['Enums']['fsrs_state'];
          state_before: Database['public']['Enums']['fsrs_state'];
          user_id: string;
        };
        Update: {
          card_id?: string;
          difficulty_after?: number | null;
          difficulty_before?: number | null;
          duration_ms?: number | null;
          elapsed_days?: number;
          id?: string;
          rating?: number;
          reviewed_at?: string;
          scheduled_days?: number;
          stability_after?: number | null;
          stability_before?: number | null;
          state_after?: Database['public']['Enums']['fsrs_state'];
          state_before?: Database['public']['Enums']['fsrs_state'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reviews_card_id_fkey';
            columns: ['card_id'];
            isOneToOne: false;
            referencedRelation: 'cards';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      card_kind: 'basic' | 'cloze' | 'mcq';
      card_status: 'draft' | 'active' | 'suspended' | 'archived';
      deck_status: 'generating' | 'draft' | 'active' | 'failed';
      fsrs_state: 'new' | 'learning' | 'review' | 'relearning';
      gen_source: 'text' | 'document' | 'manual';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      card_kind: ['basic', 'cloze', 'mcq'],
      card_status: ['draft', 'active', 'suspended', 'archived'],
      deck_status: ['generating', 'draft', 'active', 'failed'],
      fsrs_state: ['new', 'learning', 'review', 'relearning'],
      gen_source: ['text', 'document', 'manual'],
    },
  },
} as const;
