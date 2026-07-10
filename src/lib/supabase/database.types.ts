// Database/Json/Tables/TablesInsert/TablesUpdate/Enums/CompositeTypes/Constants は
// 実際のSupabaseスキーマから生成されたもの (正)。スキーマ変更後は以下で再生成すること:
//   npx supabase gen types typescript --project-id otmxouhgxtcnnzhmkoft > src/lib/supabase/database.types.ts
// ドメイン固有のUnion型・Row別名は生成後に手動で再追記する (下部参照)。

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
  public: {
    Tables: {
      api_usage_log: {
        Row: {
          cache_creation_input_tokens: number
          cache_read_input_tokens: number
          created_at: string
          duration_ms: number | null
          estimated_cost_usd: number
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          race_id: string | null
          tier: string
        }
        Insert: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          created_at?: string
          duration_ms?: number | null
          estimated_cost_usd: number
          id?: string
          input_tokens: number
          model: string
          output_tokens: number
          race_id?: string | null
          tier: string
        }
        Update: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          created_at?: string
          duration_ms?: number | null
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          race_id?: string | null
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_log_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      horses: {
        Row: {
          birth_date: string | null
          breeder_name: string | null
          coat_color: string | null
          created_at: string
          dam_name: string | null
          dam_sire_name: string | null
          horse_name: string
          id: string
          jv_horse_id: string
          owner_name: string | null
          sex: string | null
          sire_name: string | null
          trainer_affiliation: string | null
          trainer_name: string | null
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          breeder_name?: string | null
          coat_color?: string | null
          created_at?: string
          dam_name?: string | null
          dam_sire_name?: string | null
          horse_name: string
          id?: string
          jv_horse_id: string
          owner_name?: string | null
          sex?: string | null
          sire_name?: string | null
          trainer_affiliation?: string | null
          trainer_name?: string | null
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          breeder_name?: string | null
          coat_color?: string | null
          created_at?: string
          dam_name?: string | null
          dam_sire_name?: string | null
          horse_name?: string
          id?: string
          jv_horse_id?: string
          owner_name?: string | null
          sex?: string | null
          sire_name?: string | null
          trainer_affiliation?: string | null
          trainer_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      horse_pedigrees: {
        Row: {
          created_at: string
          dam_dam_dam_name: string | null
          dam_dam_name: string | null
          dam_dam_sire_name: string | null
          dam_name: string | null
          dam_sire_dam_name: string | null
          dam_sire_name: string | null
          dam_sire_sire_name: string | null
          data_source: string
          horse_id: string
          id: string
          sire_dam_dam_name: string | null
          sire_dam_name: string | null
          sire_dam_sire_name: string | null
          sire_name: string | null
          sire_sire_dam_name: string | null
          sire_sire_name: string | null
          sire_sire_sire_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dam_dam_dam_name?: string | null
          dam_dam_name?: string | null
          dam_dam_sire_name?: string | null
          dam_name?: string | null
          dam_sire_dam_name?: string | null
          dam_sire_name?: string | null
          dam_sire_sire_name?: string | null
          data_source?: string
          horse_id: string
          id?: string
          sire_dam_dam_name?: string | null
          sire_dam_name?: string | null
          sire_dam_sire_name?: string | null
          sire_name?: string | null
          sire_sire_dam_name?: string | null
          sire_sire_name?: string | null
          sire_sire_sire_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dam_dam_dam_name?: string | null
          dam_dam_name?: string | null
          dam_dam_sire_name?: string | null
          dam_name?: string | null
          dam_sire_dam_name?: string | null
          dam_sire_name?: string | null
          dam_sire_sire_name?: string | null
          data_source?: string
          horse_id?: string
          id?: string
          sire_dam_dam_name?: string | null
          sire_dam_name?: string | null
          sire_dam_sire_name?: string | null
          sire_name?: string | null
          sire_sire_dam_name?: string | null
          sire_sire_name?: string | null
          sire_sire_sire_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "horse_pedigrees_horse_id_fkey"
            columns: ["horse_id"]
            isOneToOne: true
            referencedRelation: "horses"
            referencedColumns: ["id"]
          },
        ]
      }
      nick_stats: {
        Row: {
          as_of_date: string | null
          created_at: string
          dam_sire_name: string
          data_source: string
          id: string
          place_rate: number | null
          roi_win_pct: number | null
          sire_name: string
          starts: number | null
          stat_category: string
          stat_key: string
          updated_at: string
          win_rate: number | null
          wins: number | null
        }
        Insert: {
          as_of_date?: string | null
          created_at?: string
          dam_sire_name: string
          data_source: string
          id?: string
          place_rate?: number | null
          roi_win_pct?: number | null
          sire_name: string
          starts?: number | null
          stat_category: string
          stat_key: string
          updated_at?: string
          win_rate?: number | null
          wins?: number | null
        }
        Update: {
          as_of_date?: string | null
          created_at?: string
          dam_sire_name?: string
          data_source?: string
          id?: string
          place_rate?: number | null
          roi_win_pct?: number | null
          sire_name?: string
          starts?: number | null
          stat_category?: string
          stat_key?: string
          updated_at?: string
          win_rate?: number | null
          wins?: number | null
        }
        Relationships: []
      }
      past_performances: {
        Row: {
          agari_3f_sec: number | null
          bias_note: string | null
          corner_positions: string | null
          created_at: string
          data_source: string
          distance_m: number | null
          entry_count: number | null
          finish_position: number | null
          finish_time_sec: number | null
          grade: string | null
          horse_id: string
          horse_number: number | null
          horse_weight_diff_kg: number | null
          horse_weight_kg: number | null
          id: string
          jockey_name: string | null
          jockey_weight_kg: number | null
          keibajo_code: string | null
          keibajo_name: string | null
          level_verification_note: string | null
          margin_sec: number | null
          odds_win: number | null
          pace_mark: string | null
          popularity: number | null
          post_position: number | null
          race_class: string | null
          race_date: string
          race_entry_id: string | null
          race_id: string | null
          race_name: string | null
          race_number: number | null
          source_url: string | null
          track_condition: string | null
          track_type: string | null
          trouble_note: string | null
          updated_at: string
          weather: string | null
        }
        Insert: {
          agari_3f_sec?: number | null
          bias_note?: string | null
          corner_positions?: string | null
          created_at?: string
          data_source?: string
          distance_m?: number | null
          entry_count?: number | null
          finish_position?: number | null
          finish_time_sec?: number | null
          grade?: string | null
          horse_id: string
          horse_number?: number | null
          horse_weight_diff_kg?: number | null
          horse_weight_kg?: number | null
          id?: string
          jockey_name?: string | null
          jockey_weight_kg?: number | null
          keibajo_code?: string | null
          keibajo_name?: string | null
          level_verification_note?: string | null
          margin_sec?: number | null
          odds_win?: number | null
          pace_mark?: string | null
          popularity?: number | null
          post_position?: number | null
          race_class?: string | null
          race_date: string
          race_entry_id?: string | null
          race_id?: string | null
          race_name?: string | null
          race_number?: number | null
          source_url?: string | null
          track_condition?: string | null
          track_type?: string | null
          trouble_note?: string | null
          updated_at?: string
          weather?: string | null
        }
        Update: {
          agari_3f_sec?: number | null
          bias_note?: string | null
          corner_positions?: string | null
          created_at?: string
          data_source?: string
          distance_m?: number | null
          entry_count?: number | null
          finish_position?: number | null
          finish_time_sec?: number | null
          grade?: string | null
          horse_id?: string
          horse_number?: number | null
          horse_weight_diff_kg?: number | null
          horse_weight_kg?: number | null
          id?: string
          jockey_name?: string | null
          jockey_weight_kg?: number | null
          keibajo_code?: string | null
          keibajo_name?: string | null
          level_verification_note?: string | null
          margin_sec?: number | null
          odds_win?: number | null
          pace_mark?: string | null
          popularity?: number | null
          post_position?: number | null
          race_class?: string | null
          race_date?: string
          race_entry_id?: string | null
          race_id?: string | null
          race_name?: string | null
          race_number?: number | null
          source_url?: string | null
          track_condition?: string | null
          track_type?: string | null
          trouble_note?: string | null
          updated_at?: string
          weather?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "past_performances_horse_id_fkey"
            columns: ["horse_id"]
            isOneToOne: false
            referencedRelation: "horses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "past_performances_race_entry_id_fkey"
            columns: ["race_entry_id"]
            isOneToOne: false
            referencedRelation: "race_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "past_performances_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_criteria: {
        Row: {
          created_at: string
          criteria_key: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          target_level: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criteria_key: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          target_level: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criteria_key?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          target_level?: string
          updated_at?: string
        }
        Relationships: []
      }
      race_criteria_scores: {
        Row: {
          created_at: string
          criteria_id: string
          id: string
          race_id: string
          rank_mark: string | null
          raw_data: Json | null
          reason: string | null
          score: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          criteria_id: string
          id?: string
          race_id: string
          rank_mark?: string | null
          raw_data?: Json | null
          reason?: string | null
          score?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          criteria_id?: string
          id?: string
          race_id?: string
          rank_mark?: string | null
          raw_data?: Json | null
          reason?: string | null
          score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_criteria_scores_criteria_id_fkey"
            columns: ["criteria_id"]
            isOneToOne: false
            referencedRelation: "prediction_criteria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_criteria_scores_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_entries: {
        Row: {
          actual_popularity: number | null
          blinkers_change: string | null
          created_at: string
          equipment_note: string | null
          expected_popularity: number | null
          finish_position: number | null
          finish_time_sec: number | null
          horse_id: string
          horse_number: number
          horse_rank: string | null
          horse_rank_comment: string | null
          horse_weight_diff_kg: number | null
          horse_weight_kg: number | null
          id: string
          is_kesshi: boolean
          jockey_name: string | null
          jockey_weight_kg: number | null
          kesshi_reason: string | null
          odds_win: number | null
          post_position: number
          race_id: string
          trainer_name: string | null
          updated_at: string
        }
        Insert: {
          actual_popularity?: number | null
          blinkers_change?: string | null
          created_at?: string
          equipment_note?: string | null
          expected_popularity?: number | null
          finish_position?: number | null
          finish_time_sec?: number | null
          horse_id: string
          horse_number: number
          horse_rank?: string | null
          horse_rank_comment?: string | null
          horse_weight_diff_kg?: number | null
          horse_weight_kg?: number | null
          id?: string
          is_kesshi?: boolean
          jockey_name?: string | null
          jockey_weight_kg?: number | null
          kesshi_reason?: string | null
          odds_win?: number | null
          post_position: number
          race_id: string
          trainer_name?: string | null
          updated_at?: string
        }
        Update: {
          actual_popularity?: number | null
          blinkers_change?: string | null
          created_at?: string
          equipment_note?: string | null
          expected_popularity?: number | null
          finish_position?: number | null
          finish_time_sec?: number | null
          horse_id?: string
          horse_number?: number
          horse_rank?: string | null
          horse_rank_comment?: string | null
          horse_weight_diff_kg?: number | null
          horse_weight_kg?: number | null
          id?: string
          is_kesshi?: boolean
          jockey_name?: string | null
          jockey_weight_kg?: number | null
          kesshi_reason?: string | null
          odds_win?: number | null
          post_position?: number
          race_id?: string
          trainer_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_entries_horse_id_fkey"
            columns: ["horse_id"]
            isOneToOne: false
            referencedRelation: "horses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_entries_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_entry_criteria_scores: {
        Row: {
          created_at: string
          criteria_id: string
          id: string
          race_entry_id: string
          rank_mark: string | null
          raw_data: Json | null
          reason: string | null
          score: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          criteria_id: string
          id?: string
          race_entry_id: string
          rank_mark?: string | null
          raw_data?: Json | null
          reason?: string | null
          score?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          criteria_id?: string
          id?: string
          race_entry_id?: string
          rank_mark?: string | null
          raw_data?: Json | null
          reason?: string | null
          score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_entry_criteria_scores_criteria_id_fkey"
            columns: ["criteria_id"]
            isOneToOne: false
            referencedRelation: "prediction_criteria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_entry_criteria_scores_race_entry_id_fkey"
            columns: ["race_entry_id"]
            isOneToOne: false
            referencedRelation: "race_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      race_payouts: {
        Row: {
          bet_type: string
          combination: string
          created_at: string
          data_source: string
          id: string
          payout_yen: number
          popularity: number | null
          race_id: string
          updated_at: string
        }
        Insert: {
          bet_type: string
          combination: string
          created_at?: string
          data_source?: string
          id?: string
          payout_yen: number
          popularity?: number | null
          race_id: string
          updated_at?: string
        }
        Update: {
          bet_type?: string
          combination?: string
          created_at?: string
          data_source?: string
          id?: string
          payout_yen?: number
          popularity?: number | null
          race_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_payouts_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_recommendation_results: {
        Row: {
          aite_horse_number: number | null
          bet_type: string | null
          computed_at: string | null
          created_at: string
          honmei_horse_number: number | null
          id: string
          is_hit: boolean | null
          race_id: string
          return_yen: number | null
          roi_pct: number | null
          stake_yen: number | null
          updated_at: string
        }
        Insert: {
          aite_horse_number?: number | null
          bet_type?: string | null
          computed_at?: string | null
          created_at?: string
          honmei_horse_number?: number | null
          id?: string
          is_hit?: boolean | null
          race_id: string
          return_yen?: number | null
          roi_pct?: number | null
          stake_yen?: number | null
          updated_at?: string
        }
        Update: {
          aite_horse_number?: number | null
          bet_type?: string | null
          computed_at?: string | null
          created_at?: string
          honmei_horse_number?: number | null
          id?: string
          is_hit?: boolean | null
          race_id?: string
          return_yen?: number | null
          roi_pct?: number | null
          stake_yen?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_recommendation_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: true
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          aite_horse_number: number | null
          analysis_favorite: string | null
          analysis_level: string | null
          analysis_pace: string | null
          analysis_rival: string | null
          analysis_value: string | null
          bet_amount_umaren: number | null
          bet_amount_wide: number | null
          bet_type: string | null
          bias_note: string | null
          bias_reference_race_id: string | null
          created_at: string
          distance_m: number
          entry_count: number | null
          grade: string | null
          honmei_horse_number: number | null
          id: string
          jv_race_key: string
          kaiji: number | null
          keibajo_code: string
          keibajo_name: string | null
          nichiji: number | null
          post_time: string | null
          race_class: string | null
          race_date: string
          race_name: string | null
          race_number: number
          race_rank: string | null
          race_rank_reason: string | null
          track_condition: string | null
          track_type: string
          turn_direction: string | null
          updated_at: string
          weather: string | null
        }
        Insert: {
          aite_horse_number?: number | null
          analysis_favorite?: string | null
          analysis_level?: string | null
          analysis_pace?: string | null
          analysis_rival?: string | null
          analysis_value?: string | null
          bet_amount_umaren?: number | null
          bet_amount_wide?: number | null
          bet_type?: string | null
          bias_note?: string | null
          bias_reference_race_id?: string | null
          created_at?: string
          distance_m: number
          entry_count?: number | null
          grade?: string | null
          honmei_horse_number?: number | null
          id?: string
          jv_race_key: string
          kaiji?: number | null
          keibajo_code: string
          keibajo_name?: string | null
          nichiji?: number | null
          post_time?: string | null
          race_class?: string | null
          race_date: string
          race_name?: string | null
          race_number: number
          race_rank?: string | null
          race_rank_reason?: string | null
          track_condition?: string | null
          track_type: string
          turn_direction?: string | null
          updated_at?: string
          weather?: string | null
        }
        Update: {
          aite_horse_number?: number | null
          analysis_favorite?: string | null
          analysis_level?: string | null
          analysis_pace?: string | null
          analysis_rival?: string | null
          analysis_value?: string | null
          bet_amount_umaren?: number | null
          bet_amount_wide?: number | null
          bet_type?: string | null
          bias_note?: string | null
          bias_reference_race_id?: string | null
          created_at?: string
          distance_m?: number
          entry_count?: number | null
          grade?: string | null
          honmei_horse_number?: number | null
          id?: string
          jv_race_key?: string
          kaiji?: number | null
          keibajo_code?: string
          keibajo_name?: string | null
          nichiji?: number | null
          post_time?: string | null
          race_class?: string | null
          race_date?: string
          race_name?: string | null
          race_number?: number
          race_rank?: string | null
          race_rank_reason?: string | null
          track_condition?: string | null
          track_type?: string
          turn_direction?: string | null
          updated_at?: string
          weather?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "races_bias_reference_race_id_fkey"
            columns: ["bias_reference_race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      sire_stats: {
        Row: {
          as_of_date: string | null
          created_at: string
          data_source: string
          id: string
          place_rate: number | null
          roi_win_pct: number | null
          sire_name: string
          starts: number | null
          stat_category: string
          stat_key: string
          updated_at: string
          win_rate: number | null
          wins: number | null
        }
        Insert: {
          as_of_date?: string | null
          created_at?: string
          data_source: string
          id?: string
          place_rate?: number | null
          roi_win_pct?: number | null
          sire_name: string
          starts?: number | null
          stat_category: string
          stat_key: string
          updated_at?: string
          win_rate?: number | null
          wins?: number | null
        }
        Update: {
          as_of_date?: string | null
          created_at?: string
          data_source?: string
          id?: string
          place_rate?: number | null
          roi_win_pct?: number | null
          sire_name?: string
          starts?: number | null
          stat_category?: string
          stat_key?: string
          updated_at?: string
          win_rate?: number | null
          wins?: number | null
        }
        Relationships: []
      }
      training_sessions: {
        Row: {
          ashi_iro: string | null
          awase_result: string | null
          awase_uma: string | null
          course_code: string | null
          created_at: string
          data_source: string
          evaluator_comment: string | null
          facility: string | null
          horse_id: string
          id: string
          lap_times_sec: Json
          total_time_sec: number | null
          trainer_name: string | null
          training_date: string
          training_time: string | null
          training_type: string
          turn_direction: string | null
          updated_at: string
        }
        Insert: {
          ashi_iro?: string | null
          awase_result?: string | null
          awase_uma?: string | null
          course_code?: string | null
          created_at?: string
          data_source?: string
          evaluator_comment?: string | null
          facility?: string | null
          horse_id: string
          id?: string
          lap_times_sec: Json
          total_time_sec?: number | null
          trainer_name?: string | null
          training_date: string
          training_time?: string | null
          training_type: string
          turn_direction?: string | null
          updated_at?: string
        }
        Update: {
          ashi_iro?: string | null
          awase_result?: string | null
          awase_uma?: string | null
          course_code?: string | null
          created_at?: string
          data_source?: string
          evaluator_comment?: string | null
          facility?: string | null
          horse_id?: string
          id?: string
          lap_times_sec?: Json
          total_time_sec?: number | null
          trainer_name?: string | null
          training_date?: string
          training_time?: string | null
          training_type?: string
          turn_direction?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_sessions_horse_id_fkey"
            columns: ["horse_id"]
            isOneToOne: false
            referencedRelation: "horses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const

// ============================================================
// ここから下は手動追記。DB側はCHECK制約でドメインを絞っているが
// gen typesはCHECK制約をUnion型に変換しないため、アプリコード用に別途定義する。
// ============================================================

export type TrackType = "芝" | "ダート" | "障害";
export type TrackCondition = "良" | "稍重" | "重" | "不良";
export type TurnDirection = "右" | "左";
export type RaceRank = "S" | "A" | "B" | "C";
export type BetType = "wide" | "umaren" | "both";
export type PayoutBetType =
  | "win"
  | "place"
  | "wakuren"
  | "umaren"
  | "wide"
  | "umatan"
  | "sanrenpuku"
  | "sanrentan";
export type Sex = "牡" | "牝" | "セ";
export type BlinkersChange = "新規" | "継続" | "解除";
export type PaceMark = "S" | "M" | "H";
export type DataSource = "jv_link" | "netkeiba";
export type CriteriaTargetLevel = "race" | "entry";
export type TrainingType = "坂路" | "ウッドチップ";
export type Facility = "美浦" | "栗東";
export type SireStatCategory = "distance_band" | "track_type" | "course";
export type UsageLogTier = "screening" | "standard" | "premium";

// テーブル別Row型の別名 (Tables<"races"> 等の代わりに使える短縮形)
export type RaceRow = Tables<"races">;
export type HorseRow = Tables<"horses">;
export type HorsePedigreeRow = Tables<"horse_pedigrees">;
export type RaceEntryRow = Tables<"race_entries">;
export type PastPerformanceRow = Tables<"past_performances">;
export type PredictionCriteriaRow = Tables<"prediction_criteria">;
export type RaceEntryCriteriaScoreRow = Tables<"race_entry_criteria_scores">;
export type RaceCriteriaScoreRow = Tables<"race_criteria_scores">;
export type TrainingSessionRow = Tables<"training_sessions">;
export type SireStatRow = Tables<"sire_stats">;
export type NickStatRow = Tables<"nick_stats">;
export type ApiUsageLogRow = Tables<"api_usage_log">;
export type RacePayoutRow = Tables<"race_payouts">;
export type RaceRecommendationResultRow = Tables<"race_recommendation_results">;
