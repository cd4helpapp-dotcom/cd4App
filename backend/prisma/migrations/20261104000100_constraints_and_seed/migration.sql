-- Rules Prisma cannot express in its schema: allowed values, one-live-record rules, links between tables and starting data.

-- Allowed values
ALTER TABLE profiles ADD CONSTRAINT profiles_age_check CHECK (age IS NULL OR age BETWEEN 1 AND 120);
ALTER TABLE profiles ADD CONSTRAINT profiles_pulse_check CHECK (pulse IS NULL OR pulse BETWEEN 20 AND 250);
ALTER TABLE profiles ADD CONSTRAINT profiles_gender_check CHECK (gender IS NULL OR gender IN ('Male', 'Female', 'Other'));
ALTER TABLE slots ADD CONSTRAINT slots_time_order_check CHECK (end_time > start_time);
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled'));
ALTER TABLE appointments ADD CONSTRAINT appointments_type_check CHECK (appointment_type IN ('consultation', 'second_opinion'));
ALTER TABLE appointments ADD CONSTRAINT appointments_cancelled_by_check CHECK (cancelled_by IS NULL OR cancelled_by IN ('patient', 'doctor', 'admin'));
ALTER TABLE appointment_payments ADD CONSTRAINT appointment_payments_status_check CHECK (status IN ('created', 'paid', 'failed', 'refunded'));
ALTER TABLE doctor_payouts ADD CONSTRAINT doctor_payouts_amount_check CHECK (amount > 0);
ALTER TABLE doctor_payouts ADD CONSTRAINT doctor_payouts_status_check CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'reversed'));
ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_cycle_check CHECK (billing_cycle IN ('monthly', 'yearly'));
ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_status_check CHECK (status IN ('pending', 'active', 'trialing', 'grace', 'cancelled', 'expired'));
ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_status_check CHECK (status IN ('created', 'paid', 'failed', 'refunded'));
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_type_check CHECK (type IN ('text', 'image', 'file'));
ALTER TABLE call_sessions ADD CONSTRAINT call_sessions_type_check CHECK (type IN ('audio', 'video'));
ALTER TABLE call_sessions ADD CONSTRAINT call_sessions_status_check CHECK (status IN ('ringing', 'active', 'ended', 'declined', 'missed'));
ALTER TABLE medical_reports ADD CONSTRAINT medical_reports_status_check CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed'));
ALTER TABLE medical_report_chat_messages ADD CONSTRAINT medical_report_chat_role_check CHECK (role IN ('user', 'assistant'));
ALTER TABLE ai_chat_messages ADD CONSTRAINT ai_chat_messages_sender_check CHECK (sender IN ('user', 'ai'));
ALTER TABLE community_posts ADD CONSTRAINT community_posts_category_check CHECK (category IN ('general', 'success_stories', 'challenges', 'mentor_tips'));
ALTER TABLE community_posts ADD CONSTRAINT community_posts_status_check CHECK (status IN ('published', 'pending_review', 'hidden', 'rejected'));
ALTER TABLE community_posts ADD CONSTRAINT community_posts_counts_check CHECK (like_count >= 0 AND comment_count >= 0 AND share_count >= 0);
ALTER TABLE community_post_comments ADD CONSTRAINT community_comments_status_check CHECK (status IN ('published', 'hidden', 'rejected'));
ALTER TABLE community_post_reports ADD CONSTRAINT community_reports_status_check CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned'));
ALTER TABLE community_follows ADD CONSTRAINT community_follows_no_self CHECK (follower_id <> following_id);
ALTER TABLE community_user_blocks ADD CONSTRAINT community_blocks_no_self CHECK (blocker_id <> blocked_user_id);
ALTER TABLE hospital_onboarding_requests ADD CONSTRAINT hospital_onboarding_status_check CHECK (status IN ('new', 'under_review', 'contacted', 'approved', 'rejected', 'converted'));
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_status_check CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'));

-- One live record at a time. These hold even if two requests arrive together.
CREATE UNIQUE INDEX call_sessions_one_live_per_room ON call_sessions (room_id) WHERE status IN ('ringing', 'active');
CREATE UNIQUE INDEX appointments_one_active_per_slot ON appointments (slot_id) WHERE status IN ('pending', 'confirmed');

-- Links
ALTER TABLE slots ADD CONSTRAINT slots_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE;
ALTER TABLE appointments ADD CONSTRAINT appointments_patient_fk FOREIGN KEY (patient_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE appointments ADD CONSTRAINT appointments_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE;
ALTER TABLE appointments ADD CONSTRAINT appointments_slot_fk FOREIGN KEY (slot_id) REFERENCES slots (id) ON DELETE CASCADE;
ALTER TABLE appointments ADD CONSTRAINT appointments_report_fk FOREIGN KEY (ai_report_id) REFERENCES ai_triage_reports (id) ON DELETE SET NULL;
ALTER TABLE doctor_payouts ADD CONSTRAINT doctor_payouts_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE RESTRICT;
ALTER TABLE appointment_payments ADD CONSTRAINT payments_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE SET NULL;
ALTER TABLE appointment_payments ADD CONSTRAINT payments_patient_fk FOREIGN KEY (patient_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE appointment_payments ADD CONSTRAINT payments_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE;
ALTER TABLE appointment_payments ADD CONSTRAINT payments_slot_fk FOREIGN KEY (slot_id) REFERENCES slots (id) ON DELETE CASCADE;
ALTER TABLE appointment_payments ADD CONSTRAINT payments_payout_fk FOREIGN KEY (payout_id) REFERENCES doctor_payouts (id) ON DELETE SET NULL;
ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_patient_fk FOREIGN KEY (patient_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_room_fk FOREIGN KEY (room_id) REFERENCES chat_rooms (id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_sender_fk FOREIGN KEY (sender_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_reply_fk FOREIGN KEY (reply_to_id) REFERENCES chat_messages (id) ON DELETE SET NULL;
ALTER TABLE chat_e2ee_key_backups ADD CONSTRAINT chat_key_backups_user_fk FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE call_sessions ADD CONSTRAINT call_sessions_room_fk FOREIGN KEY (room_id) REFERENCES chat_rooms (id) ON DELETE CASCADE;
ALTER TABLE call_sessions ADD CONSTRAINT call_sessions_caller_fk FOREIGN KEY (caller_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE in_app_notifications ADD CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE medical_reports ADD CONSTRAINT medical_reports_patient_fk FOREIGN KEY (patient_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE medical_report_chat_messages ADD CONSTRAINT report_chat_report_fk FOREIGN KEY (report_id) REFERENCES medical_reports (id) ON DELETE CASCADE;
ALTER TABLE medical_report_chunks ADD CONSTRAINT report_chunks_report_fk FOREIGN KEY (report_id) REFERENCES medical_reports (id) ON DELETE CASCADE;
ALTER TABLE ai_chat_conversations ADD CONSTRAINT ai_conversations_user_fk FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE ai_chat_messages ADD CONSTRAINT ai_messages_conversation_fk FOREIGN KEY (conversation_id) REFERENCES ai_chat_conversations (id) ON DELETE CASCADE;
ALTER TABLE ai_triage_reports ADD CONSTRAINT ai_triage_patient_fk FOREIGN KEY (patient_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE ai_usage_stats ADD CONSTRAINT ai_usage_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE community_posts ADD CONSTRAINT community_posts_author_fk FOREIGN KEY (author_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE community_post_comments ADD CONSTRAINT community_comments_post_fk FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE;
ALTER TABLE community_post_comments ADD CONSTRAINT community_comments_author_fk FOREIGN KEY (author_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE community_post_comments ADD CONSTRAINT community_comments_parent_fk FOREIGN KEY (parent_id) REFERENCES community_post_comments (id) ON DELETE SET NULL;
ALTER TABLE community_post_likes ADD CONSTRAINT community_likes_post_fk FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE;
ALTER TABLE community_post_likes ADD CONSTRAINT community_likes_user_fk FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE community_post_reports ADD CONSTRAINT community_reports_post_fk FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE CASCADE;
ALTER TABLE community_follows ADD CONSTRAINT community_follows_follower_fk FOREIGN KEY (follower_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE community_follows ADD CONSTRAINT community_follows_following_fk FOREIGN KEY (following_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE community_user_blocks ADD CONSTRAINT community_blocks_blocker_fk FOREIGN KEY (blocker_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE community_user_blocks ADD CONSTRAINT community_blocks_blocked_fk FOREIGN KEY (blocked_user_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE community_muted_keywords ADD CONSTRAINT community_muted_user_fk FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE hospital_doctors ADD CONSTRAINT hospital_doctors_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE;
ALTER TABLE hospital_patients ADD CONSTRAINT hospital_patients_patient_fk FOREIGN KEY (patient_id) REFERENCES profiles (id) ON DELETE CASCADE;

-- Starting data
INSERT INTO roles (name, slug, description) VALUES
  ('Patient', 'patient', 'A person using CD4 for their own health'),
  ('Doctor', 'doctor', 'A doctor who consults on CD4'),
  ('Hospital', 'hospital', 'A hospital administrator'),
  ('Admin', 'admin', 'A CD4 administrator');
