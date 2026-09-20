SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: protect_audit_logs_from_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_audit_logs_from_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit logs are append-only';
  END IF;

  IF NEW.user_id IS NULL
     AND OLD.user_id IS NOT NULL
     AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit logs are append-only';
END;
$$;


--
-- Name: protect_finalized_payroll_records(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_finalized_payroll_records() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'payroll_batches' AND TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW)->>'finalized_by_id') IS NULL
       AND (to_jsonb(OLD)->>'finalized_by_id') IS NOT NULL
       AND (to_jsonb(NEW) - 'finalized_by_id') = (to_jsonb(OLD) - 'finalized_by_id') THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'finalized payroll records are append-only';
END;
$$;


--
-- Name: protect_payroll_calendar_period_after_cutoff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_payroll_calendar_period_after_cutoff() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payroll calendar periods cannot be deleted';
  END IF;
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION 'finalized payroll calendar periods are immutable';
  END IF;
  IF (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') >= OLD.cutoff_at
     AND (
       NEW.external_pay_period_id IS DISTINCT FROM OLD.external_pay_period_id
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.pay_date IS DISTINCT FROM OLD.pay_date
       OR NEW.cutoff_at IS DISTINCT FROM OLD.cutoff_at
       OR NEW.time_zone IS DISTINCT FROM OLD.time_zone
       OR NEW.cutoff_days_before IS DISTINCT FROM OLD.cutoff_days_before
       OR NEW.cutoff_policy IS DISTINCT FROM OLD.cutoff_policy
       OR NEW.cutoff_days_after_pay_date IS DISTINCT FROM OLD.cutoff_days_after_pay_date
       OR NEW.schedule_version IS DISTINCT FROM OLD.schedule_version
       OR NEW.publication_id IS DISTINCT FROM OLD.publication_id
       OR NEW.request_checksum IS DISTINCT FROM OLD.request_checksum
     ) THEN
    RAISE EXCEPTION 'payroll calendar schedules cannot change after cutoff';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: protect_payroll_calendar_revision(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_payroll_calendar_revision() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'payroll calendar revisions are append-only';
END;
$$;


--
-- Name: protect_payroll_integration_command(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_payroll_integration_command() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'payroll integration commands are append-only';
END;
$$;


--
-- Name: protect_payroll_outbox_payload(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_payroll_outbox_payload() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payroll outbox events cannot be deleted';
  END IF;

  IF NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.payroll_calendar_period_id IS DISTINCT FROM OLD.payroll_calendar_period_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'payroll outbox event payloads are immutable';
  END IF;

  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: active_storage_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_storage_attachments (
    id bigint NOT NULL,
    name character varying NOT NULL,
    record_type character varying NOT NULL,
    record_id bigint NOT NULL,
    blob_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: active_storage_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_storage_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_storage_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_storage_attachments_id_seq OWNED BY public.active_storage_attachments.id;


--
-- Name: active_storage_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_storage_blobs (
    id bigint NOT NULL,
    key character varying NOT NULL,
    filename character varying NOT NULL,
    content_type character varying,
    metadata text,
    service_name character varying NOT NULL,
    byte_size bigint NOT NULL,
    checksum character varying,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: active_storage_blobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_storage_blobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_storage_blobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_storage_blobs_id_seq OWNED BY public.active_storage_blobs.id;


--
-- Name: active_storage_variant_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_storage_variant_records (
    id bigint NOT NULL,
    blob_id bigint NOT NULL,
    variation_digest character varying NOT NULL
);


--
-- Name: active_storage_variant_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_storage_variant_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_storage_variant_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_storage_variant_records_id_seq OWNED BY public.active_storage_variant_records.id;


--
-- Name: ar_internal_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_internal_metadata (
    key character varying NOT NULL,
    value character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    auditable_type character varying NOT NULL,
    auditable_id bigint NOT NULL,
    action character varying NOT NULL,
    user_id bigint,
    changes_made jsonb,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    event_category character varying DEFAULT 'activity'::character varying NOT NULL,
    occurred_at timestamp(6) without time zone NOT NULL,
    actor_name character varying,
    actor_email character varying,
    actor_role character varying,
    actor_kind character varying DEFAULT 'user'::character varying NOT NULL,
    source character varying DEFAULT 'web'::character varying NOT NULL,
    subject_name character varying,
    outcome character varying DEFAULT 'succeeded'::character varying NOT NULL,
    request_id character varying,
    ip_address character varying,
    user_agent character varying,
    correlation_id character varying,
    session_fingerprint character varying
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: employee_pay_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_pay_rates (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    time_category_id bigint NOT NULL,
    hourly_rate_cents integer NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: employee_pay_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_pay_rates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_pay_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_pay_rates_id_seq OWNED BY public.employee_pay_rates.id;


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_requests (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    reviewed_by_id bigint,
    leave_type character varying NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    reason text,
    review_note text,
    reviewed_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    cancelled_by_id bigint,
    cancelled_at timestamp(6) without time zone
);


--
-- Name: leave_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leave_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leave_requests_id_seq OWNED BY public.leave_requests.id;


--
-- Name: payroll_account_link_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_account_link_sessions (
    id bigint NOT NULL,
    token_digest character varying NOT NULL,
    external_system character varying DEFAULT 'cornerstone_payroll'::character varying NOT NULL,
    external_actor_id character varying NOT NULL,
    external_actor_email character varying,
    return_url character varying NOT NULL,
    expires_at timestamp(6) without time zone NOT NULL,
    consumed_at timestamp(6) without time zone,
    linked_user_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: payroll_account_link_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_account_link_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_account_link_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_account_link_sessions_id_seq OWNED BY public.payroll_account_link_sessions.id;


--
-- Name: payroll_account_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_account_links (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    external_system character varying DEFAULT 'cornerstone_payroll'::character varying NOT NULL,
    external_actor_id character varying NOT NULL,
    external_actor_email character varying,
    active boolean DEFAULT true NOT NULL,
    linked_at timestamp(6) without time zone NOT NULL,
    revoked_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: payroll_account_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_account_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_account_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_account_links_id_seq OWNED BY public.payroll_account_links.id;


--
-- Name: payroll_batch_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_batch_entries (
    id bigint NOT NULL,
    payroll_batch_id bigint NOT NULL,
    source_time_entry_id bigint NOT NULL,
    source_user_id bigint NOT NULL,
    source_category_id bigint,
    work_date date NOT NULL,
    week_start date NOT NULL,
    total_hours numeric(8,2) DEFAULT 0.0 NOT NULL,
    regular_hours numeric(8,2) DEFAULT 0.0 NOT NULL,
    overtime_hours numeric(8,2) DEFAULT 0.0 NOT NULL,
    effective_rate_cents integer,
    source_kind character varying NOT NULL,
    line_key character varying NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    source_user_uuid uuid
);


--
-- Name: payroll_batch_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_batch_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_batch_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_batch_entries_id_seq OWNED BY public.payroll_batch_entries.id;


--
-- Name: payroll_batch_exclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_batch_exclusions (
    id bigint NOT NULL,
    payroll_batch_id bigint NOT NULL,
    source_time_entry_id bigint NOT NULL,
    source_user_id bigint NOT NULL,
    reason character varying NOT NULL,
    held_total_hours numeric(8,2) DEFAULT 0.0 NOT NULL,
    held_regular_hours numeric(8,2) DEFAULT 0.0 NOT NULL,
    held_overtime_hours numeric(8,2) DEFAULT 0.0 NOT NULL,
    first_excluded_batch_public_id character varying,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    source_user_uuid uuid
);


--
-- Name: payroll_batch_exclusions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_batch_exclusions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_batch_exclusions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_batch_exclusions_id_seq OWNED BY public.payroll_batch_exclusions.id;


--
-- Name: payroll_batch_processing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_batch_processing_events (
    id bigint NOT NULL,
    payroll_batch_id bigint NOT NULL,
    event_id character varying NOT NULL,
    status character varying NOT NULL,
    external_system character varying NOT NULL,
    external_pay_period_id character varying,
    occurred_at timestamp(6) without time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: payroll_batch_processing_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_batch_processing_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_batch_processing_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_batch_processing_events_id_seq OWNED BY public.payroll_batch_processing_events.id;


--
-- Name: payroll_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_batches (
    id bigint NOT NULL,
    public_id character varying NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    cutoff_at timestamp(6) without time zone NOT NULL,
    finalized_at timestamp(6) without time zone NOT NULL,
    finalized_by_id bigint,
    schema_version character varying DEFAULT '2.0'::character varying NOT NULL,
    checksum character varying NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    issues jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT check_payroll_batches_date_order CHECK ((end_date >= start_date))
);


--
-- Name: payroll_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_batches_id_seq OWNED BY public.payroll_batches.id;


--
-- Name: payroll_calendar_period_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_calendar_period_revisions (
    id bigint NOT NULL,
    payroll_calendar_period_id bigint NOT NULL,
    schedule_version integer NOT NULL,
    publication_id uuid NOT NULL,
    request_checksum character varying NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    published_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT check_payroll_calendar_revision_version CHECK ((schedule_version > 0))
);


--
-- Name: payroll_calendar_period_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_calendar_period_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_calendar_period_revisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_calendar_period_revisions_id_seq OWNED BY public.payroll_calendar_period_revisions.id;


--
-- Name: payroll_calendar_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_calendar_periods (
    id bigint NOT NULL,
    external_pay_period_id character varying NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    pay_date date NOT NULL,
    cutoff_at timestamp(6) without time zone NOT NULL,
    time_zone character varying DEFAULT 'Pacific/Guam'::character varying NOT NULL,
    cutoff_days_before integer DEFAULT 7 NOT NULL,
    schedule_version integer NOT NULL,
    publication_id uuid NOT NULL,
    request_checksum character varying NOT NULL,
    status character varying DEFAULT 'scheduled'::character varying NOT NULL,
    payroll_batch_id bigint,
    finalized_at timestamp(6) without time zone,
    finalization_attempts integer DEFAULT 0 NOT NULL,
    last_finalization_attempt_at timestamp(6) without time zone,
    next_finalization_attempt_at timestamp(6) without time zone,
    last_finalization_error character varying,
    lock_version integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    cutoff_policy character varying DEFAULT 'before_current_pay_date'::character varying NOT NULL,
    cutoff_days_after_pay_date integer,
    CONSTRAINT check_payroll_calendar_period_cutoff_date CHECK (((((cutoff_policy)::text = 'before_current_pay_date'::text) AND (cutoff_days_after_pay_date IS NULL) AND ((((cutoff_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'Pacific/Guam'::text))::date = (pay_date - cutoff_days_before))) OR (((cutoff_policy)::text = 'after_regular_pay_date'::text) AND (cutoff_days_after_pay_date = 7) AND ((((cutoff_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'Pacific/Guam'::text))::date = (pay_date + cutoff_days_after_pay_date)) AND ((((cutoff_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'Pacific/Guam'::text))::time without time zone = '17:00:00'::time without time zone)))),
    CONSTRAINT check_payroll_calendar_period_cutoff_days CHECK ((cutoff_days_before = 7)),
    CONSTRAINT check_payroll_calendar_period_date_order CHECK ((end_date >= start_date)),
    CONSTRAINT check_payroll_calendar_period_pay_date CHECK ((pay_date > end_date)),
    CONSTRAINT check_payroll_calendar_period_semimonthly CHECK ((((EXTRACT(day FROM start_date) = (1)::numeric) AND (EXTRACT(day FROM end_date) = (15)::numeric) AND (date_trunc('month'::text, (start_date)::timestamp without time zone) = date_trunc('month'::text, (end_date)::timestamp without time zone))) OR ((EXTRACT(day FROM start_date) = (16)::numeric) AND (end_date = ((date_trunc('month'::text, (start_date)::timestamp without time zone) + '1 mon -1 days'::interval))::date)))),
    CONSTRAINT check_payroll_calendar_period_status CHECK (((status)::text = ANY (ARRAY[('scheduled'::character varying)::text, ('failed'::character varying)::text, ('finalized'::character varying)::text]))),
    CONSTRAINT check_payroll_calendar_period_time_zone CHECK (((time_zone)::text = 'Pacific/Guam'::text)),
    CONSTRAINT check_payroll_calendar_period_version CHECK ((schedule_version > 0))
);


--
-- Name: payroll_calendar_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_calendar_periods_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_calendar_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_calendar_periods_id_seq OWNED BY public.payroll_calendar_periods.id;


--
-- Name: payroll_entry_processing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_entry_processing_events (
    id bigint NOT NULL,
    payroll_batch_id bigint NOT NULL,
    event_id character varying NOT NULL,
    source_time_entry_id bigint NOT NULL,
    source_user_uuid uuid,
    status character varying NOT NULL,
    external_system character varying NOT NULL,
    external_pay_period_id character varying,
    external_payroll_item_id character varying,
    payment_method character varying,
    payment_reference character varying,
    occurred_at timestamp(6) without time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: payroll_entry_processing_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_entry_processing_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_entry_processing_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_entry_processing_events_id_seq OWNED BY public.payroll_entry_processing_events.id;


--
-- Name: payroll_integration_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_integration_commands (
    id bigint NOT NULL,
    command_id uuid NOT NULL,
    action character varying NOT NULL,
    actor_id bigint NOT NULL,
    actor_payroll_integration_uuid uuid NOT NULL,
    target_type character varying NOT NULL,
    target_id bigint NOT NULL,
    expected_version integer NOT NULL,
    request_checksum character varying NOT NULL,
    response_status integer NOT NULL,
    result_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT check_payroll_commands_expected_version CHECK ((expected_version >= 0)),
    CONSTRAINT check_payroll_commands_response_status CHECK (((response_status >= 200) AND (response_status <= 299))),
    CONSTRAINT check_payroll_commands_result_metadata_object CHECK ((jsonb_typeof(result_metadata) = 'object'::text))
);


--
-- Name: payroll_integration_commands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_integration_commands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_integration_commands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_integration_commands_id_seq OWNED BY public.payroll_integration_commands.id;


--
-- Name: payroll_integration_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_integration_grants (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    token_digest character varying NOT NULL,
    token_hint character varying NOT NULL,
    capabilities character varying[] DEFAULT '{}'::character varying[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    expires_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT check_payroll_integration_grant_capabilities CHECK ((capabilities <@ ARRAY['time_approval'::character varying, 'payroll_finalization'::character varying, 'time_correction'::character varying, 'settlement_case_management'::character varying]))
);


--
-- Name: payroll_integration_grants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_integration_grants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_integration_grants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_integration_grants_id_seq OWNED BY public.payroll_integration_grants.id;


--
-- Name: payroll_manual_allocation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_manual_allocation_events (
    id bigint NOT NULL,
    payroll_manual_allocation_id bigint NOT NULL,
    actor_id bigint NOT NULL,
    event_type character varying NOT NULL,
    occurred_at timestamp(6) without time zone NOT NULL,
    payment_method character varying,
    payment_reference character varying,
    reason text NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT check_payroll_manual_allocation_events_type CHECK (((event_type)::text = ANY ((ARRAY['committed'::character varying, 'issued'::character varying, 'voided'::character varying])::text[])))
);


--
-- Name: payroll_manual_allocation_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_manual_allocation_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_manual_allocation_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_manual_allocation_events_id_seq OWNED BY public.payroll_manual_allocation_events.id;


--
-- Name: payroll_manual_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_manual_allocations (
    id bigint NOT NULL,
    time_entry_id bigint NOT NULL,
    user_id bigint NOT NULL,
    recorded_by_id bigint NOT NULL,
    source_user_uuid uuid NOT NULL,
    source_time_entry_version integer NOT NULL,
    work_date date NOT NULL,
    pay_date date NOT NULL,
    time_category_id bigint,
    regular_hours numeric(8,2) NOT NULL,
    overtime_hours numeric(8,2) NOT NULL,
    external_pay_period_id character varying NOT NULL,
    external_payroll_item_id character varying NOT NULL,
    payment_method character varying,
    payment_reference character varying,
    status character varying DEFAULT 'committed'::character varying NOT NULL,
    reason text NOT NULL,
    issued_at timestamp(6) without time zone,
    voided_at timestamp(6) without time zone,
    lock_version integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT manual_allocation_positive_hours CHECK (((regular_hours >= (0)::numeric) AND (overtime_hours >= (0)::numeric) AND ((regular_hours + overtime_hours) > (0)::numeric))),
    CONSTRAINT manual_allocation_status CHECK (((status)::text = ANY ((ARRAY['committed'::character varying, 'issued'::character varying, 'voided'::character varying])::text[])))
);


--
-- Name: payroll_manual_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_manual_allocations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_manual_allocations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_manual_allocations_id_seq OWNED BY public.payroll_manual_allocations.id;


--
-- Name: payroll_outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_outbox_events (
    id bigint NOT NULL,
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying NOT NULL,
    payroll_calendar_period_id bigint NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp(6) without time zone NOT NULL,
    delivery_status character varying DEFAULT 'pending'::character varying NOT NULL,
    delivery_attempts integer DEFAULT 0 NOT NULL,
    last_delivery_attempt_at timestamp(6) without time zone,
    next_delivery_attempt_at timestamp(6) without time zone,
    delivery_enqueued_until timestamp(6) without time zone,
    delivered_at timestamp(6) without time zone,
    last_response_status integer,
    last_error character varying,
    lock_version integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT check_payroll_outbox_delivery_attempts CHECK ((delivery_attempts >= 0)),
    CONSTRAINT check_payroll_outbox_delivery_status CHECK (((delivery_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('failed'::character varying)::text, ('delivered'::character varying)::text])))
);


--
-- Name: payroll_outbox_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_outbox_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_outbox_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_outbox_events_id_seq OWNED BY public.payroll_outbox_events.id;


--
-- Name: payroll_settlement_case_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_settlement_case_events (
    id bigint NOT NULL,
    payroll_settlement_case_id bigint NOT NULL,
    event_id uuid NOT NULL,
    actor_id bigint,
    actor_payroll_integration_uuid uuid,
    event_type character varying NOT NULL,
    from_status character varying,
    to_status character varying NOT NULL,
    occurred_at timestamp(6) without time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT check_payroll_settlement_case_events_from_status CHECK (((from_status IS NULL) OR ((from_status)::text = ANY (ARRAY[('open'::character varying)::text, ('scheduled'::character varying)::text, ('in_payroll'::character varying)::text, ('settled'::character varying)::text, ('not_payable'::character varying)::text, ('superseded'::character varying)::text])))),
    CONSTRAINT check_payroll_settlement_case_events_metadata CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT check_payroll_settlement_case_events_to_status CHECK (((to_status)::text = ANY (ARRAY[('open'::character varying)::text, ('scheduled'::character varying)::text, ('in_payroll'::character varying)::text, ('settled'::character varying)::text, ('not_payable'::character varying)::text, ('superseded'::character varying)::text]))),
    CONSTRAINT check_payroll_settlement_case_events_type CHECK (((event_type)::text = ANY (ARRAY[('opened'::character varying)::text, ('routed'::character varying)::text, ('rerouted'::character varying)::text, ('corrected'::character varying)::text, ('approval_changed'::character varying)::text, ('included'::character varying)::text, ('imported'::character varying)::text, ('committed'::character varying)::text, ('payment_prepared'::character varying)::text, ('payment_issued'::character varying)::text, ('payment_failed'::character varying)::text, ('payment_voided'::character varying)::text, ('payment_returned'::character varying)::text, ('settled'::character varying)::text, ('marked_not_payable'::character varying)::text, ('superseded'::character varying)::text])))
);


--
-- Name: payroll_settlement_case_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_settlement_case_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_settlement_case_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_settlement_case_events_id_seq OWNED BY public.payroll_settlement_case_events.id;


--
-- Name: payroll_settlement_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_settlement_cases (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_time_entry_id bigint NOT NULL,
    source_time_entry_version integer DEFAULT 0 NOT NULL,
    source_user_id bigint NOT NULL,
    source_user_uuid uuid,
    origin_payroll_batch_id bigint NOT NULL,
    origin_payroll_batch_exclusion_id bigint,
    supersedes_case_id bigint,
    target_payroll_calendar_period_id bigint,
    included_payroll_batch_id bigint,
    assigned_to_id bigint,
    origin_reason character varying NOT NULL,
    original_work_date date NOT NULL,
    held_total_hours numeric(8,2) DEFAULT 0.0 NOT NULL,
    destination_kind character varying DEFAULT 'unassigned'::character varying NOT NULL,
    target_external_pay_period_id character varying,
    owner_role character varying DEFAULT 'aire_admins'::character varying NOT NULL,
    action_due_on date NOT NULL,
    status character varying DEFAULT 'open'::character varying NOT NULL,
    resolution_note text,
    resolved_at timestamp(6) without time zone,
    lock_version integer DEFAULT 0 NOT NULL,
    source_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT check_payroll_settlement_cases_destination CHECK (((destination_kind)::text = ANY (ARRAY[('unassigned'::character varying)::text, ('regular'::character varying)::text, ('supplemental'::character varying)::text, ('not_payable'::character varying)::text]))),
    CONSTRAINT check_payroll_settlement_cases_hours CHECK ((held_total_hours >= (0)::numeric)),
    CONSTRAINT check_payroll_settlement_cases_included_shape CHECK ((((status)::text <> ALL (ARRAY[('in_payroll'::character varying)::text, ('settled'::character varying)::text])) OR ((destination_kind)::text = 'supplemental'::text) OR (included_payroll_batch_id IS NOT NULL))),
    CONSTRAINT check_payroll_settlement_cases_owner_role CHECK (((owner_role)::text = 'aire_admins'::text)),
    CONSTRAINT check_payroll_settlement_cases_resolution_shape CHECK ((((status)::text = ANY (ARRAY[('settled'::character varying)::text, ('not_payable'::character varying)::text, ('superseded'::character varying)::text])) = (resolved_at IS NOT NULL))),
    CONSTRAINT check_payroll_settlement_cases_routing_shape CHECK (((((destination_kind)::text = 'regular'::text) AND (target_payroll_calendar_period_id IS NOT NULL) AND (target_external_pay_period_id IS NOT NULL)) OR (((destination_kind)::text = 'supplemental'::text) AND (target_payroll_calendar_period_id IS NULL) AND (target_external_pay_period_id IS NOT NULL)) OR (((destination_kind)::text = 'unassigned'::text) AND (target_payroll_calendar_period_id IS NULL) AND (target_external_pay_period_id IS NULL) AND ((status)::text = ANY (ARRAY[('open'::character varying)::text, ('superseded'::character varying)::text]))) OR (((destination_kind)::text = 'not_payable'::text) AND (target_payroll_calendar_period_id IS NULL) AND (target_external_pay_period_id IS NULL) AND ((status)::text = 'not_payable'::text)))),
    CONSTRAINT check_payroll_settlement_cases_snapshot CHECK ((jsonb_typeof(source_snapshot) = 'object'::text)),
    CONSTRAINT check_payroll_settlement_cases_status CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('scheduled'::character varying)::text, ('in_payroll'::character varying)::text, ('settled'::character varying)::text, ('not_payable'::character varying)::text, ('superseded'::character varying)::text])))
);


--
-- Name: payroll_settlement_cases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_settlement_cases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_settlement_cases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_settlement_cases_id_seq OWNED BY public.payroll_settlement_cases.id;


--
-- Name: payroll_settlement_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_settlement_reconciliations (
    id bigint NOT NULL,
    payroll_calendar_period_id bigint NOT NULL,
    reconciled_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: payroll_settlement_reconciliations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_settlement_reconciliations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_settlement_reconciliations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_settlement_reconciliations_id_seq OWNED BY public.payroll_settlement_reconciliations.id;


--
-- Name: report_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_exports (
    id bigint NOT NULL,
    public_id character varying NOT NULL,
    export_type character varying NOT NULL,
    readiness_status character varying NOT NULL,
    state character varying DEFAULT 'active'::character varying NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    generated_by_id bigint,
    employee_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    entry_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    issues jsonb DEFAULT '{}'::jsonb NOT NULL,
    entry_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    checksum character varying NOT NULL,
    protects_entries boolean DEFAULT false NOT NULL,
    generated_at timestamp(6) without time zone NOT NULL,
    stale_at timestamp(6) without time zone,
    stale_reason text,
    download_count integer DEFAULT 1 NOT NULL,
    last_downloaded_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: report_exports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_exports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: report_exports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_exports_id_seq OWNED BY public.report_exports.id;


--
-- Name: schedule_time_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_time_presets (
    id bigint NOT NULL,
    label character varying NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: schedule_time_presets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schedule_time_presets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schedule_time_presets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schedule_time_presets_id_seq OWNED BY public.schedule_time_presets.id;


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id bigint NOT NULL,
    user_id bigint,
    work_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    notes text,
    created_by_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schedules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schedules_id_seq OWNED BY public.schedules.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id bigint NOT NULL,
    key character varying,
    value text,
    description character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: site_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_media (
    id bigint NOT NULL,
    title character varying NOT NULL,
    alt_text character varying,
    caption character varying,
    placement character varying NOT NULL,
    media_type character varying DEFAULT 'image'::character varying NOT NULL,
    external_url character varying,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    featured boolean DEFAULT false NOT NULL,
    uploaded_by_id bigint,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: site_media_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.site_media_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: site_media_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.site_media_id_seq OWNED BY public.site_media.id;


--
-- Name: solid_queue_blocked_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_blocked_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    queue_name character varying NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    concurrency_key character varying NOT NULL,
    expires_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_blocked_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_blocked_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_blocked_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_blocked_executions_id_seq OWNED BY public.solid_queue_blocked_executions.id;


--
-- Name: solid_queue_claimed_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_claimed_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    process_id bigint,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_claimed_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_claimed_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_claimed_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_claimed_executions_id_seq OWNED BY public.solid_queue_claimed_executions.id;


--
-- Name: solid_queue_failed_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_failed_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    error text,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_failed_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_failed_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_failed_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_failed_executions_id_seq OWNED BY public.solid_queue_failed_executions.id;


--
-- Name: solid_queue_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_jobs (
    id bigint NOT NULL,
    queue_name character varying NOT NULL,
    class_name character varying NOT NULL,
    arguments text,
    priority integer DEFAULT 0 NOT NULL,
    active_job_id character varying,
    scheduled_at timestamp(6) without time zone,
    finished_at timestamp(6) without time zone,
    concurrency_key character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_jobs_id_seq OWNED BY public.solid_queue_jobs.id;


--
-- Name: solid_queue_pauses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_pauses (
    id bigint NOT NULL,
    queue_name character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_pauses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_pauses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_pauses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_pauses_id_seq OWNED BY public.solid_queue_pauses.id;


--
-- Name: solid_queue_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_processes (
    id bigint NOT NULL,
    kind character varying NOT NULL,
    last_heartbeat_at timestamp(6) without time zone NOT NULL,
    supervisor_id bigint,
    pid integer NOT NULL,
    hostname character varying,
    metadata text,
    created_at timestamp(6) without time zone NOT NULL,
    name character varying NOT NULL
);


--
-- Name: solid_queue_processes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_processes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_processes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_processes_id_seq OWNED BY public.solid_queue_processes.id;


--
-- Name: solid_queue_ready_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_ready_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    queue_name character varying NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_ready_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_ready_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_ready_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_ready_executions_id_seq OWNED BY public.solid_queue_ready_executions.id;


--
-- Name: solid_queue_recurring_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_recurring_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    task_key character varying NOT NULL,
    run_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_recurring_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_recurring_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_recurring_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_recurring_executions_id_seq OWNED BY public.solid_queue_recurring_executions.id;


--
-- Name: solid_queue_recurring_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_recurring_tasks (
    id bigint NOT NULL,
    key character varying NOT NULL,
    schedule character varying NOT NULL,
    command character varying(2048),
    class_name character varying,
    arguments text,
    queue_name character varying,
    priority integer DEFAULT 0,
    static boolean DEFAULT true NOT NULL,
    description text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_recurring_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_recurring_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_recurring_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_recurring_tasks_id_seq OWNED BY public.solid_queue_recurring_tasks.id;


--
-- Name: solid_queue_scheduled_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_scheduled_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    queue_name character varying NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    scheduled_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_scheduled_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_scheduled_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_scheduled_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_scheduled_executions_id_seq OWNED BY public.solid_queue_scheduled_executions.id;


--
-- Name: solid_queue_semaphores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_semaphores (
    id bigint NOT NULL,
    key character varying NOT NULL,
    value integer DEFAULT 1 NOT NULL,
    expires_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_semaphores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_semaphores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_semaphores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_semaphores_id_seq OWNED BY public.solid_queue_semaphores.id;


--
-- Name: time_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_categories (
    id bigint NOT NULL,
    name character varying NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    key character varying,
    hourly_rate_cents integer
);


--
-- Name: time_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.time_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: time_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.time_categories_id_seq OWNED BY public.time_categories.id;


--
-- Name: time_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_entries (
    id bigint NOT NULL,
    user_id bigint,
    time_category_id bigint,
    work_date date NOT NULL,
    hours numeric(4,2) NOT NULL,
    description text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    break_minutes integer,
    start_time time without time zone,
    end_time time without time zone,
    schedule_id bigint,
    clock_in_at timestamp(6) without time zone,
    clock_out_at timestamp(6) without time zone,
    entry_method character varying DEFAULT 'manual'::character varying NOT NULL,
    status character varying DEFAULT 'completed'::character varying NOT NULL,
    admin_override boolean DEFAULT false NOT NULL,
    attendance_status character varying,
    approval_status character varying,
    approved_by_id bigint,
    approved_at timestamp(6) without time zone,
    approval_note text,
    overtime_status character varying,
    overtime_approved_by_id bigint,
    overtime_approved_at timestamp(6) without time zone,
    overtime_note text,
    clock_source character varying,
    effective_rate_cents_snapshot integer,
    lock_version integer DEFAULT 0 NOT NULL
);


--
-- Name: time_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.time_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: time_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.time_entries_id_seq OWNED BY public.time_entries.id;


--
-- Name: time_entry_breaks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_entry_breaks (
    id bigint NOT NULL,
    time_entry_id bigint NOT NULL,
    start_time timestamp(6) without time zone NOT NULL,
    end_time timestamp(6) without time zone,
    duration_minutes integer,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: time_entry_breaks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.time_entry_breaks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: time_entry_breaks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.time_entry_breaks_id_seq OWNED BY public.time_entry_breaks.id;


--
-- Name: user_approval_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_approval_groups (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    approval_group character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: user_approval_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_approval_groups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_approval_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_approval_groups_id_seq OWNED BY public.user_approval_groups.id;


--
-- Name: user_time_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_time_categories (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    time_category_id bigint NOT NULL,
    hourly_rate_cents integer,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: user_time_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_time_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_time_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_time_categories_id_seq OWNED BY public.user_time_categories.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    clerk_id character varying NOT NULL,
    email character varying,
    first_name character varying,
    last_name character varying,
    role character varying DEFAULT 'employee'::character varying,
    phone character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    kiosk_pin_digest character varying,
    kiosk_pin_lookup_hash character varying,
    kiosk_pin_last_rotated_at timestamp(6) without time zone,
    kiosk_enabled boolean DEFAULT false NOT NULL,
    kiosk_failed_attempts_count integer DEFAULT 0 NOT NULL,
    kiosk_locked_until timestamp(6) without time zone,
    approval_group character varying,
    is_active boolean DEFAULT true NOT NULL,
    public_team_enabled boolean DEFAULT false NOT NULL,
    public_team_name character varying,
    public_team_title character varying,
    public_team_sort_order integer DEFAULT 0 NOT NULL,
    staff_title character varying,
    is_intern boolean DEFAULT false NOT NULL,
    public_team_photo_position_x integer DEFAULT 50 NOT NULL,
    public_team_photo_position_y integer DEFAULT 50 NOT NULL,
    personal_access_enabled boolean DEFAULT false NOT NULL,
    profile_source character varying DEFAULT 'local'::character varying NOT NULL,
    time_tracking_enabled boolean DEFAULT false NOT NULL,
    payroll_integration_uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT check_public_team_photo_position_x_range CHECK (((public_team_photo_position_x >= 0) AND (public_team_photo_position_x <= 100))),
    CONSTRAINT check_public_team_photo_position_y_range CHECK (((public_team_photo_position_y >= 0) AND (public_team_photo_position_y <= 100))),
    CONSTRAINT check_users_kiosk_matches_time_tracking CHECK ((kiosk_enabled = time_tracking_enabled)),
    CONSTRAINT check_users_profile_source CHECK (((profile_source)::text = ANY (ARRAY[('clerk'::character varying)::text, ('local'::character varying)::text]))),
    CONSTRAINT check_valid_role CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('employee'::character varying)::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: active_storage_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_attachments ALTER COLUMN id SET DEFAULT nextval('public.active_storage_attachments_id_seq'::regclass);


--
-- Name: active_storage_blobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_blobs ALTER COLUMN id SET DEFAULT nextval('public.active_storage_blobs_id_seq'::regclass);


--
-- Name: active_storage_variant_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_variant_records ALTER COLUMN id SET DEFAULT nextval('public.active_storage_variant_records_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: employee_pay_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pay_rates ALTER COLUMN id SET DEFAULT nextval('public.employee_pay_rates_id_seq'::regclass);


--
-- Name: leave_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests ALTER COLUMN id SET DEFAULT nextval('public.leave_requests_id_seq'::regclass);


--
-- Name: payroll_account_link_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_account_link_sessions ALTER COLUMN id SET DEFAULT nextval('public.payroll_account_link_sessions_id_seq'::regclass);


--
-- Name: payroll_account_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_account_links ALTER COLUMN id SET DEFAULT nextval('public.payroll_account_links_id_seq'::regclass);


--
-- Name: payroll_batch_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batch_entries ALTER COLUMN id SET DEFAULT nextval('public.payroll_batch_entries_id_seq'::regclass);


--
-- Name: payroll_batch_exclusions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batch_exclusions ALTER COLUMN id SET DEFAULT nextval('public.payroll_batch_exclusions_id_seq'::regclass);


--
-- Name: payroll_batch_processing_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batch_processing_events ALTER COLUMN id SET DEFAULT nextval('public.payroll_batch_processing_events_id_seq'::regclass);


--
-- Name: payroll_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches ALTER COLUMN id SET DEFAULT nextval('public.payroll_batches_id_seq'::regclass);


--
-- Name: payroll_calendar_period_revisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_calendar_period_revisions ALTER COLUMN id SET DEFAULT nextval('public.payroll_calendar_period_revisions_id_seq'::regclass);


--
-- Name: payroll_calendar_periods id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_calendar_periods ALTER COLUMN id SET DEFAULT nextval('public.payroll_calendar_periods_id_seq'::regclass);


--
-- Name: payroll_entry_processing_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_entry_processing_events ALTER COLUMN id SET DEFAULT nextval('public.payroll_entry_processing_events_id_seq'::regclass);


--
-- Name: payroll_integration_commands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_integration_commands ALTER COLUMN id SET DEFAULT nextval('public.payroll_integration_commands_id_seq'::regclass);


--
-- Name: payroll_integration_grants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_integration_grants ALTER COLUMN id SET DEFAULT nextval('public.payroll_integration_grants_id_seq'::regclass);


--
-- Name: payroll_manual_allocation_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_manual_allocation_events ALTER COLUMN id SET DEFAULT nextval('public.payroll_manual_allocation_events_id_seq'::regclass);


--
-- Name: payroll_manual_allocations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_manual_allocations ALTER COLUMN id SET DEFAULT nextval('public.payroll_manual_allocations_id_seq'::regclass);


--
-- Name: payroll_outbox_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_outbox_events ALTER COLUMN id SET DEFAULT nextval('public.payroll_outbox_events_id_seq'::regclass);


--
-- Name: payroll_settlement_case_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_case_events ALTER COLUMN id SET DEFAULT nextval('public.payroll_settlement_case_events_id_seq'::regclass);


--
-- Name: payroll_settlement_cases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_cases ALTER COLUMN id SET DEFAULT nextval('public.payroll_settlement_cases_id_seq'::regclass);


--
-- Name: payroll_settlement_reconciliations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_reconciliations ALTER COLUMN id SET DEFAULT nextval('public.payroll_settlement_reconciliations_id_seq'::regclass);


--
-- Name: report_exports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_exports ALTER COLUMN id SET DEFAULT nextval('public.report_exports_id_seq'::regclass);


--
-- Name: schedule_time_presets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_time_presets ALTER COLUMN id SET DEFAULT nextval('public.schedule_time_presets_id_seq'::regclass);


--
-- Name: schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules ALTER COLUMN id SET DEFAULT nextval('public.schedules_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: site_media id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_media ALTER COLUMN id SET DEFAULT nextval('public.site_media_id_seq'::regclass);


--
-- Name: solid_queue_blocked_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_blocked_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_blocked_executions_id_seq'::regclass);


--
-- Name: solid_queue_claimed_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_claimed_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_claimed_executions_id_seq'::regclass);


--
-- Name: solid_queue_failed_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_failed_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_failed_executions_id_seq'::regclass);


--
-- Name: solid_queue_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_jobs ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_jobs_id_seq'::regclass);


--
-- Name: solid_queue_pauses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_pauses ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_pauses_id_seq'::regclass);


--
-- Name: solid_queue_processes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_processes ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_processes_id_seq'::regclass);


--
-- Name: solid_queue_ready_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_ready_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_ready_executions_id_seq'::regclass);


--
-- Name: solid_queue_recurring_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_recurring_executions_id_seq'::regclass);


--
-- Name: solid_queue_recurring_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_tasks ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_recurring_tasks_id_seq'::regclass);


--
-- Name: solid_queue_scheduled_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_scheduled_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_scheduled_executions_id_seq'::regclass);


--
-- Name: solid_queue_semaphores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_semaphores ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_semaphores_id_seq'::regclass);


--
-- Name: time_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_categories ALTER COLUMN id SET DEFAULT nextval('public.time_categories_id_seq'::regclass);


--
-- Name: time_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries ALTER COLUMN id SET DEFAULT nextval('public.time_entries_id_seq'::regclass);


--
-- Name: time_entry_breaks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entry_breaks ALTER COLUMN id SET DEFAULT nextval('public.time_entry_breaks_id_seq'::regclass);


--
-- Name: user_approval_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_approval_groups ALTER COLUMN id SET DEFAULT nextval('public.user_approval_groups_id_seq'::regclass);


--
-- Name: user_time_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_time_categories ALTER COLUMN id SET DEFAULT nextval('public.user_time_categories_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: active_storage_attachments active_storage_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_attachments
    ADD CONSTRAINT active_storage_attachments_pkey PRIMARY KEY (id);


--
-- Name: active_storage_blobs active_storage_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_blobs
    ADD CONSTRAINT active_storage_blobs_pkey PRIMARY KEY (id);


--
-- Name: active_storage_variant_records active_storage_variant_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_variant_records
    ADD CONSTRAINT active_storage_variant_records_pkey PRIMARY KEY (id);


--
-- Name: ar_internal_metadata ar_internal_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_internal_metadata
    ADD CONSTRAINT ar_internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: employee_pay_rates employee_pay_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pay_rates
    ADD CONSTRAINT employee_pay_rates_pkey PRIMARY KEY (id);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);


--
-- Name: payroll_account_link_sessions payroll_account_link_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_account_link_sessions
    ADD CONSTRAINT payroll_account_link_sessions_pkey PRIMARY KEY (id);


--
-- Name: payroll_account_links payroll_account_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_account_links
    ADD CONSTRAINT payroll_account_links_pkey PRIMARY KEY (id);


--
-- Name: payroll_batch_entries payroll_batch_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batch_entries
    ADD CONSTRAINT payroll_batch_entries_pkey PRIMARY KEY (id);


--
-- Name: payroll_batch_exclusions payroll_batch_exclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batch_exclusions
    ADD CONSTRAINT payroll_batch_exclusions_pkey PRIMARY KEY (id);


--
-- Name: payroll_batch_processing_events payroll_batch_processing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batch_processing_events
    ADD CONSTRAINT payroll_batch_processing_events_pkey PRIMARY KEY (id);


--
-- Name: payroll_batches payroll_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches
    ADD CONSTRAINT payroll_batches_pkey PRIMARY KEY (id);


--
-- Name: payroll_calendar_period_revisions payroll_calendar_period_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_calendar_period_revisions
    ADD CONSTRAINT payroll_calendar_period_revisions_pkey PRIMARY KEY (id);


--
-- Name: payroll_calendar_periods payroll_calendar_periods_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_calendar_periods
    ADD CONSTRAINT payroll_calendar_periods_no_overlap EXCLUDE USING gist (daterange(start_date, end_date, '[]'::text) WITH &&);


--
-- Name: payroll_calendar_periods payroll_calendar_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_calendar_periods
    ADD CONSTRAINT payroll_calendar_periods_pkey PRIMARY KEY (id);


--
-- Name: payroll_entry_processing_events payroll_entry_processing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_entry_processing_events
    ADD CONSTRAINT payroll_entry_processing_events_pkey PRIMARY KEY (id);


--
-- Name: payroll_integration_commands payroll_integration_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_integration_commands
    ADD CONSTRAINT payroll_integration_commands_pkey PRIMARY KEY (id);


--
-- Name: payroll_integration_grants payroll_integration_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_integration_grants
    ADD CONSTRAINT payroll_integration_grants_pkey PRIMARY KEY (id);


--
-- Name: payroll_manual_allocation_events payroll_manual_allocation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_manual_allocation_events
    ADD CONSTRAINT payroll_manual_allocation_events_pkey PRIMARY KEY (id);


--
-- Name: payroll_manual_allocations payroll_manual_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_manual_allocations
    ADD CONSTRAINT payroll_manual_allocations_pkey PRIMARY KEY (id);


--
-- Name: payroll_outbox_events payroll_outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_outbox_events
    ADD CONSTRAINT payroll_outbox_events_pkey PRIMARY KEY (id);


--
-- Name: payroll_settlement_case_events payroll_settlement_case_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_case_events
    ADD CONSTRAINT payroll_settlement_case_events_pkey PRIMARY KEY (id);


--
-- Name: payroll_settlement_cases payroll_settlement_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_cases
    ADD CONSTRAINT payroll_settlement_cases_pkey PRIMARY KEY (id);


--
-- Name: payroll_settlement_reconciliations payroll_settlement_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_reconciliations
    ADD CONSTRAINT payroll_settlement_reconciliations_pkey PRIMARY KEY (id);


--
-- Name: report_exports report_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_exports
    ADD CONSTRAINT report_exports_pkey PRIMARY KEY (id);


--
-- Name: schedule_time_presets schedule_time_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_time_presets
    ADD CONSTRAINT schedule_time_presets_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: site_media site_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_media
    ADD CONSTRAINT site_media_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_blocked_executions solid_queue_blocked_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_blocked_executions
    ADD CONSTRAINT solid_queue_blocked_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_claimed_executions solid_queue_claimed_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_claimed_executions
    ADD CONSTRAINT solid_queue_claimed_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_failed_executions solid_queue_failed_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_failed_executions
    ADD CONSTRAINT solid_queue_failed_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_jobs solid_queue_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_jobs
    ADD CONSTRAINT solid_queue_jobs_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_pauses solid_queue_pauses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_pauses
    ADD CONSTRAINT solid_queue_pauses_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_processes solid_queue_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_processes
    ADD CONSTRAINT solid_queue_processes_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_ready_executions solid_queue_ready_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_ready_executions
    ADD CONSTRAINT solid_queue_ready_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_recurring_executions solid_queue_recurring_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_executions
    ADD CONSTRAINT solid_queue_recurring_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_recurring_tasks solid_queue_recurring_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_tasks
    ADD CONSTRAINT solid_queue_recurring_tasks_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_scheduled_executions solid_queue_scheduled_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_scheduled_executions
    ADD CONSTRAINT solid_queue_scheduled_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_semaphores solid_queue_semaphores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_semaphores
    ADD CONSTRAINT solid_queue_semaphores_pkey PRIMARY KEY (id);


--
-- Name: time_categories time_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_categories
    ADD CONSTRAINT time_categories_pkey PRIMARY KEY (id);


--
-- Name: time_entries time_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_pkey PRIMARY KEY (id);


--
-- Name: time_entry_breaks time_entry_breaks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entry_breaks
    ADD CONSTRAINT time_entry_breaks_pkey PRIMARY KEY (id);


--
-- Name: user_approval_groups user_approval_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_approval_groups
    ADD CONSTRAINT user_approval_groups_pkey PRIMARY KEY (id);


--
-- Name: user_time_categories user_time_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_time_categories
    ADD CONSTRAINT user_time_categories_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_employee_pay_rates_user_category; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_pay_rates_user_category ON public.employee_pay_rates USING btree (user_id, time_category_id);


--
-- Name: idx_on_export_type_start_date_end_date_1234e92c05; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_on_export_type_start_date_end_date_1234e92c05 ON public.report_exports USING btree (export_type, start_date, end_date);


--
-- Name: idx_payroll_account_links_external_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_account_links_external_actor ON public.payroll_account_links USING btree (external_system, external_actor_id);


--
-- Name: idx_payroll_account_links_external_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_account_links_external_user ON public.payroll_account_links USING btree (external_system, user_id);


--
-- Name: idx_payroll_batch_processing_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_batch_processing_events_status ON public.payroll_batch_processing_events USING btree (payroll_batch_id, status, occurred_at);


--
-- Name: idx_payroll_calendar_periods_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_calendar_periods_due ON public.payroll_calendar_periods USING btree (status, cutoff_at, next_finalization_attempt_at);


--
-- Name: idx_payroll_calendar_periods_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_calendar_periods_external_id ON public.payroll_calendar_periods USING btree (external_pay_period_id);


--
-- Name: idx_payroll_calendar_revisions_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_calendar_revisions_period ON public.payroll_calendar_period_revisions USING btree (payroll_calendar_period_id);


--
-- Name: idx_payroll_calendar_revisions_period_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_calendar_revisions_period_version ON public.payroll_calendar_period_revisions USING btree (payroll_calendar_period_id, schedule_version);


--
-- Name: idx_payroll_calendar_revisions_publication; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_calendar_revisions_publication ON public.payroll_calendar_period_revisions USING btree (publication_id);


--
-- Name: idx_payroll_commands_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_commands_target ON public.payroll_integration_commands USING btree (target_type, target_id);


--
-- Name: idx_payroll_entry_processing_events_batch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_entry_processing_events_batch_status ON public.payroll_entry_processing_events USING btree (payroll_batch_id, status, occurred_at);


--
-- Name: idx_payroll_entry_processing_events_entry_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_entry_processing_events_entry_time ON public.payroll_entry_processing_events USING btree (source_time_entry_id, occurred_at);


--
-- Name: idx_payroll_outbox_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_outbox_due ON public.payroll_outbox_events USING btree (delivery_status, next_delivery_attempt_at, delivery_enqueued_until);


--
-- Name: idx_payroll_outbox_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_outbox_period ON public.payroll_outbox_events USING btree (payroll_calendar_period_id);


--
-- Name: idx_payroll_settlement_case_events_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_settlement_case_events_case ON public.payroll_settlement_case_events USING btree (payroll_settlement_case_id);


--
-- Name: idx_payroll_settlement_case_events_timeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_settlement_case_events_timeline ON public.payroll_settlement_case_events USING btree (payroll_settlement_case_id, occurred_at);


--
-- Name: idx_payroll_settlement_cases_active_origin_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_settlement_cases_active_origin_entry ON public.payroll_settlement_cases USING btree (origin_payroll_batch_id, source_time_entry_id) WHERE ((status)::text = ANY (ARRAY[('open'::character varying)::text, ('scheduled'::character varying)::text, ('in_payroll'::character varying)::text]));


--
-- Name: idx_payroll_settlement_cases_included_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_settlement_cases_included_batch ON public.payroll_settlement_cases USING btree (included_payroll_batch_id);


--
-- Name: idx_payroll_settlement_cases_origin_exclusion_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_settlement_cases_origin_exclusion_unique ON public.payroll_settlement_cases USING btree (origin_payroll_batch_exclusion_id) WHERE (origin_payroll_batch_exclusion_id IS NOT NULL);


--
-- Name: idx_payroll_settlement_cases_synthetic_origin_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_settlement_cases_synthetic_origin_unique ON public.payroll_settlement_cases USING btree (origin_payroll_batch_id, source_time_entry_id, origin_reason, source_time_entry_version) WHERE (origin_payroll_batch_exclusion_id IS NULL);


--
-- Name: idx_payroll_settlement_cases_target_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_settlement_cases_target_period ON public.payroll_settlement_cases USING btree (target_payroll_calendar_period_id);


--
-- Name: idx_payroll_settlement_cases_work_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_settlement_cases_work_queue ON public.payroll_settlement_cases USING btree (status, action_due_on);


--
-- Name: idx_payroll_settlement_reconciliations_period; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_settlement_reconciliations_period ON public.payroll_settlement_reconciliations USING btree (payroll_calendar_period_id);


--
-- Name: idx_time_entries_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_entries_user_date ON public.time_entries USING btree (user_id, work_date);


--
-- Name: idx_time_entries_user_date_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_entries_user_date_method ON public.time_entries USING btree (user_id, work_date, entry_method);


--
-- Name: index_active_storage_attachments_on_blob_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_active_storage_attachments_on_blob_id ON public.active_storage_attachments USING btree (blob_id);


--
-- Name: index_active_storage_attachments_uniqueness; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_active_storage_attachments_uniqueness ON public.active_storage_attachments USING btree (record_type, record_id, name, blob_id);


--
-- Name: index_active_storage_blobs_on_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_active_storage_blobs_on_key ON public.active_storage_blobs USING btree (key);


--
-- Name: index_active_storage_variant_records_uniqueness; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_active_storage_variant_records_uniqueness ON public.active_storage_variant_records USING btree (blob_id, variation_digest);


--
-- Name: index_audit_logs_on_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_action ON public.audit_logs USING btree (action);


--
-- Name: index_audit_logs_on_action_and_session_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_audit_logs_on_action_and_session_fingerprint ON public.audit_logs USING btree (action, session_fingerprint) WHERE (session_fingerprint IS NOT NULL);


--
-- Name: index_audit_logs_on_action_trigram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_action_trigram ON public.audit_logs USING gin (action public.gin_trgm_ops);


--
-- Name: index_audit_logs_on_actor_and_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_actor_and_occurred_at ON public.audit_logs USING btree (user_id, occurred_at);


--
-- Name: index_audit_logs_on_actor_email_trigram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_actor_email_trigram ON public.audit_logs USING gin (actor_email public.gin_trgm_ops);


--
-- Name: index_audit_logs_on_actor_name_trigram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_actor_name_trigram ON public.audit_logs USING gin (actor_name public.gin_trgm_ops);


--
-- Name: index_audit_logs_on_auditable_type_and_auditable_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_auditable_type_and_auditable_id ON public.audit_logs USING btree (auditable_type, auditable_id);


--
-- Name: index_audit_logs_on_auditable_type_trigram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_auditable_type_trigram ON public.audit_logs USING gin (auditable_type public.gin_trgm_ops);


--
-- Name: index_audit_logs_on_category_and_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_category_and_occurred_at ON public.audit_logs USING btree (event_category, occurred_at);


--
-- Name: index_audit_logs_on_correlation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_correlation_id ON public.audit_logs USING btree (correlation_id);


--
-- Name: index_audit_logs_on_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_created_at ON public.audit_logs USING btree (created_at);


--
-- Name: index_audit_logs_on_normalized_type_trigram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_normalized_type_trigram ON public.audit_logs USING gin (lower(replace(replace((auditable_type)::text, '_'::text, ''::text), ' '::text, ''::text)) public.gin_trgm_ops);


--
-- Name: index_audit_logs_on_occurred_at_and_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_occurred_at_and_id ON public.audit_logs USING btree (occurred_at, id);


--
-- Name: index_audit_logs_on_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_request_id ON public.audit_logs USING btree (request_id);


--
-- Name: index_audit_logs_on_subject_name_trigram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_subject_name_trigram ON public.audit_logs USING gin (subject_name public.gin_trgm_ops);


--
-- Name: index_audit_logs_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: index_employee_pay_rates_on_time_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_employee_pay_rates_on_time_category_id ON public.employee_pay_rates USING btree (time_category_id);


--
-- Name: index_employee_pay_rates_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_employee_pay_rates_on_user_id ON public.employee_pay_rates USING btree (user_id);


--
-- Name: index_leave_requests_on_cancelled_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_leave_requests_on_cancelled_by_id ON public.leave_requests USING btree (cancelled_by_id);


--
-- Name: index_leave_requests_on_reviewed_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_leave_requests_on_reviewed_by_id ON public.leave_requests USING btree (reviewed_by_id);


--
-- Name: index_leave_requests_on_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_leave_requests_on_status ON public.leave_requests USING btree (status);


--
-- Name: index_leave_requests_on_status_and_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_leave_requests_on_status_and_start_date ON public.leave_requests USING btree (status, start_date);


--
-- Name: index_leave_requests_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_leave_requests_on_user_id ON public.leave_requests USING btree (user_id);


--
-- Name: index_leave_requests_on_user_id_and_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_leave_requests_on_user_id_and_start_date ON public.leave_requests USING btree (user_id, start_date);


--
-- Name: index_manual_allocation_events_on_allocation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_manual_allocation_events_on_allocation ON public.payroll_manual_allocation_events USING btree (payroll_manual_allocation_id);


--
-- Name: index_manual_allocations_on_entry_and_payroll_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_manual_allocations_on_entry_and_payroll_item ON public.payroll_manual_allocations USING btree (time_entry_id, external_payroll_item_id);


--
-- Name: index_manual_allocations_on_payroll_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_manual_allocations_on_payroll_item ON public.payroll_manual_allocations USING btree (external_pay_period_id, external_payroll_item_id);


--
-- Name: index_payroll_account_link_sessions_on_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_account_link_sessions_on_expires_at ON public.payroll_account_link_sessions USING btree (expires_at);


--
-- Name: index_payroll_account_link_sessions_on_linked_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_account_link_sessions_on_linked_user_id ON public.payroll_account_link_sessions USING btree (linked_user_id);


--
-- Name: index_payroll_account_link_sessions_on_token_digest; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_account_link_sessions_on_token_digest ON public.payroll_account_link_sessions USING btree (token_digest);


--
-- Name: index_payroll_account_links_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_account_links_on_user_id ON public.payroll_account_links USING btree (user_id);


--
-- Name: index_payroll_batch_entries_on_batch_source_line; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_batch_entries_on_batch_source_line ON public.payroll_batch_entries USING btree (payroll_batch_id, source_time_entry_id, line_key);


--
-- Name: index_payroll_batch_entries_on_payroll_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batch_entries_on_payroll_batch_id ON public.payroll_batch_entries USING btree (payroll_batch_id);


--
-- Name: index_payroll_batch_entries_on_source_time_entry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batch_entries_on_source_time_entry_id ON public.payroll_batch_entries USING btree (source_time_entry_id);


--
-- Name: index_payroll_batch_entries_on_source_user_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batch_entries_on_source_user_uuid ON public.payroll_batch_entries USING btree (source_user_uuid);


--
-- Name: index_payroll_batch_entries_on_user_and_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batch_entries_on_user_and_week ON public.payroll_batch_entries USING btree (source_user_id, week_start);


--
-- Name: index_payroll_batch_exclusions_on_batch_source_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_batch_exclusions_on_batch_source_reason ON public.payroll_batch_exclusions USING btree (payroll_batch_id, source_time_entry_id, reason);


--
-- Name: index_payroll_batch_exclusions_on_payroll_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batch_exclusions_on_payroll_batch_id ON public.payroll_batch_exclusions USING btree (payroll_batch_id);


--
-- Name: index_payroll_batch_exclusions_on_source_time_entry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batch_exclusions_on_source_time_entry_id ON public.payroll_batch_exclusions USING btree (source_time_entry_id);


--
-- Name: index_payroll_batch_exclusions_on_source_user_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batch_exclusions_on_source_user_uuid ON public.payroll_batch_exclusions USING btree (source_user_uuid);


--
-- Name: index_payroll_batch_processing_events_on_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_batch_processing_events_on_event_id ON public.payroll_batch_processing_events USING btree (event_id);


--
-- Name: index_payroll_batch_processing_events_on_payroll_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batch_processing_events_on_payroll_batch_id ON public.payroll_batch_processing_events USING btree (payroll_batch_id);


--
-- Name: index_payroll_batches_on_cutoff_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batches_on_cutoff_at ON public.payroll_batches USING btree (cutoff_at);


--
-- Name: index_payroll_batches_on_finalized_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_batches_on_finalized_by_id ON public.payroll_batches USING btree (finalized_by_id);


--
-- Name: index_payroll_batches_on_public_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_batches_on_public_id ON public.payroll_batches USING btree (public_id);


--
-- Name: index_payroll_batches_on_start_date_and_end_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_batches_on_start_date_and_end_date ON public.payroll_batches USING btree (start_date, end_date);


--
-- Name: index_payroll_calendar_periods_on_payroll_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_calendar_periods_on_payroll_batch_id ON public.payroll_calendar_periods USING btree (payroll_batch_id);


--
-- Name: index_payroll_entry_processing_events_on_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_entry_processing_events_on_event_id ON public.payroll_entry_processing_events USING btree (event_id);


--
-- Name: index_payroll_entry_processing_events_on_payroll_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_entry_processing_events_on_payroll_batch_id ON public.payroll_entry_processing_events USING btree (payroll_batch_id);


--
-- Name: index_payroll_integration_commands_on_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_integration_commands_on_actor_id ON public.payroll_integration_commands USING btree (actor_id);


--
-- Name: index_payroll_integration_commands_on_command_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_integration_commands_on_command_id ON public.payroll_integration_commands USING btree (command_id);


--
-- Name: index_payroll_integration_grants_on_token_digest; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_integration_grants_on_token_digest ON public.payroll_integration_grants USING btree (token_digest);


--
-- Name: index_payroll_integration_grants_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_integration_grants_on_user_id ON public.payroll_integration_grants USING btree (user_id);


--
-- Name: index_payroll_manual_allocation_events_on_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_manual_allocation_events_on_actor_id ON public.payroll_manual_allocation_events USING btree (actor_id);


--
-- Name: index_payroll_manual_allocations_on_recorded_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_manual_allocations_on_recorded_by_id ON public.payroll_manual_allocations USING btree (recorded_by_id);


--
-- Name: index_payroll_manual_allocations_on_time_entry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_manual_allocations_on_time_entry_id ON public.payroll_manual_allocations USING btree (time_entry_id);


--
-- Name: index_payroll_manual_allocations_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_manual_allocations_on_user_id ON public.payroll_manual_allocations USING btree (user_id);


--
-- Name: index_payroll_outbox_events_on_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_outbox_events_on_event_id ON public.payroll_outbox_events USING btree (event_id);


--
-- Name: index_payroll_settlement_case_events_on_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_settlement_case_events_on_actor_id ON public.payroll_settlement_case_events USING btree (actor_id);


--
-- Name: index_payroll_settlement_case_events_on_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_settlement_case_events_on_event_id ON public.payroll_settlement_case_events USING btree (event_id);


--
-- Name: index_payroll_settlement_cases_on_assigned_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_settlement_cases_on_assigned_to_id ON public.payroll_settlement_cases USING btree (assigned_to_id);


--
-- Name: index_payroll_settlement_cases_on_origin_payroll_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_settlement_cases_on_origin_payroll_batch_id ON public.payroll_settlement_cases USING btree (origin_payroll_batch_id);


--
-- Name: index_payroll_settlement_cases_on_public_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_payroll_settlement_cases_on_public_id ON public.payroll_settlement_cases USING btree (public_id);


--
-- Name: index_payroll_settlement_cases_on_source_time_entry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_settlement_cases_on_source_time_entry_id ON public.payroll_settlement_cases USING btree (source_time_entry_id);


--
-- Name: index_payroll_settlement_cases_on_supersedes_case_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_payroll_settlement_cases_on_supersedes_case_id ON public.payroll_settlement_cases USING btree (supersedes_case_id);


--
-- Name: index_report_exports_on_checksum; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_report_exports_on_checksum ON public.report_exports USING btree (checksum);


--
-- Name: index_report_exports_on_employee_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_report_exports_on_employee_ids ON public.report_exports USING gin (employee_ids);


--
-- Name: index_report_exports_on_entry_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_report_exports_on_entry_ids ON public.report_exports USING gin (entry_ids);


--
-- Name: index_report_exports_on_generated_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_report_exports_on_generated_by_id ON public.report_exports USING btree (generated_by_id);


--
-- Name: index_report_exports_on_protects_entries_and_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_report_exports_on_protects_entries_and_state ON public.report_exports USING btree (protects_entries, state);


--
-- Name: index_report_exports_on_public_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_report_exports_on_public_id ON public.report_exports USING btree (public_id);


--
-- Name: index_schedule_time_presets_on_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_schedule_time_presets_on_active ON public.schedule_time_presets USING btree (active);


--
-- Name: index_schedule_time_presets_on_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_schedule_time_presets_on_position ON public.schedule_time_presets USING btree ("position");


--
-- Name: index_schedules_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_schedules_on_created_by_id ON public.schedules USING btree (created_by_id);


--
-- Name: index_schedules_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_schedules_on_user_id ON public.schedules USING btree (user_id);


--
-- Name: index_schedules_on_user_id_and_work_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_schedules_on_user_id_and_work_date ON public.schedules USING btree (user_id, work_date);


--
-- Name: index_schedules_on_work_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_schedules_on_work_date ON public.schedules USING btree (work_date);


--
-- Name: index_settings_on_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_settings_on_key ON public.settings USING btree (key);


--
-- Name: index_site_media_on_media_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_site_media_on_media_type ON public.site_media USING btree (media_type);


--
-- Name: index_site_media_on_placement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_site_media_on_placement ON public.site_media USING btree (placement);


--
-- Name: index_site_media_on_placement_and_active_and_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_site_media_on_placement_and_active_and_sort_order ON public.site_media USING btree (placement, active, sort_order);


--
-- Name: index_site_media_on_uploaded_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_site_media_on_uploaded_by_id ON public.site_media USING btree (uploaded_by_id);


--
-- Name: index_solid_queue_blocked_executions_for_maintenance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_blocked_executions_for_maintenance ON public.solid_queue_blocked_executions USING btree (expires_at, concurrency_key);


--
-- Name: index_solid_queue_blocked_executions_for_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_blocked_executions_for_release ON public.solid_queue_blocked_executions USING btree (concurrency_key, priority, job_id);


--
-- Name: index_solid_queue_blocked_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_blocked_executions_on_job_id ON public.solid_queue_blocked_executions USING btree (job_id);


--
-- Name: index_solid_queue_claimed_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_claimed_executions_on_job_id ON public.solid_queue_claimed_executions USING btree (job_id);


--
-- Name: index_solid_queue_claimed_executions_on_process_id_and_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_claimed_executions_on_process_id_and_job_id ON public.solid_queue_claimed_executions USING btree (process_id, job_id);


--
-- Name: index_solid_queue_dispatch_all; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_dispatch_all ON public.solid_queue_scheduled_executions USING btree (scheduled_at, priority, job_id);


--
-- Name: index_solid_queue_failed_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_failed_executions_on_job_id ON public.solid_queue_failed_executions USING btree (job_id);


--
-- Name: index_solid_queue_jobs_for_alerting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_for_alerting ON public.solid_queue_jobs USING btree (scheduled_at, finished_at);


--
-- Name: index_solid_queue_jobs_for_filtering; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_for_filtering ON public.solid_queue_jobs USING btree (queue_name, finished_at);


--
-- Name: index_solid_queue_jobs_on_active_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_on_active_job_id ON public.solid_queue_jobs USING btree (active_job_id);


--
-- Name: index_solid_queue_jobs_on_class_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_on_class_name ON public.solid_queue_jobs USING btree (class_name);


--
-- Name: index_solid_queue_jobs_on_finished_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_on_finished_at ON public.solid_queue_jobs USING btree (finished_at);


--
-- Name: index_solid_queue_pauses_on_queue_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_pauses_on_queue_name ON public.solid_queue_pauses USING btree (queue_name);


--
-- Name: index_solid_queue_poll_all; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_poll_all ON public.solid_queue_ready_executions USING btree (priority, job_id);


--
-- Name: index_solid_queue_poll_by_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_poll_by_queue ON public.solid_queue_ready_executions USING btree (queue_name, priority, job_id);


--
-- Name: index_solid_queue_processes_on_last_heartbeat_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_processes_on_last_heartbeat_at ON public.solid_queue_processes USING btree (last_heartbeat_at);


--
-- Name: index_solid_queue_processes_on_name_and_supervisor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_processes_on_name_and_supervisor_id ON public.solid_queue_processes USING btree (name, supervisor_id);


--
-- Name: index_solid_queue_processes_on_supervisor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_processes_on_supervisor_id ON public.solid_queue_processes USING btree (supervisor_id);


--
-- Name: index_solid_queue_ready_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_ready_executions_on_job_id ON public.solid_queue_ready_executions USING btree (job_id);


--
-- Name: index_solid_queue_recurring_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_recurring_executions_on_job_id ON public.solid_queue_recurring_executions USING btree (job_id);


--
-- Name: index_solid_queue_recurring_executions_on_task_key_and_run_at; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_recurring_executions_on_task_key_and_run_at ON public.solid_queue_recurring_executions USING btree (task_key, run_at);


--
-- Name: index_solid_queue_recurring_tasks_on_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_recurring_tasks_on_key ON public.solid_queue_recurring_tasks USING btree (key);


--
-- Name: index_solid_queue_recurring_tasks_on_static; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_recurring_tasks_on_static ON public.solid_queue_recurring_tasks USING btree (static);


--
-- Name: index_solid_queue_scheduled_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_scheduled_executions_on_job_id ON public.solid_queue_scheduled_executions USING btree (job_id);


--
-- Name: index_solid_queue_semaphores_on_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_semaphores_on_expires_at ON public.solid_queue_semaphores USING btree (expires_at);


--
-- Name: index_solid_queue_semaphores_on_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_semaphores_on_key ON public.solid_queue_semaphores USING btree (key);


--
-- Name: index_solid_queue_semaphores_on_key_and_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_semaphores_on_key_and_value ON public.solid_queue_semaphores USING btree (key, value);


--
-- Name: index_time_categories_on_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_time_categories_on_key ON public.time_categories USING btree (key);


--
-- Name: index_time_entries_on_approval_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_approval_status ON public.time_entries USING btree (approval_status);


--
-- Name: index_time_entries_on_approved_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_approved_by_id ON public.time_entries USING btree (approved_by_id);


--
-- Name: index_time_entries_on_clock_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_clock_source ON public.time_entries USING btree (clock_source);


--
-- Name: index_time_entries_on_entry_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_entry_method ON public.time_entries USING btree (entry_method);


--
-- Name: index_time_entries_on_overtime_approved_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_overtime_approved_by_id ON public.time_entries USING btree (overtime_approved_by_id);


--
-- Name: index_time_entries_on_overtime_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_overtime_status ON public.time_entries USING btree (overtime_status);


--
-- Name: index_time_entries_on_schedule_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_schedule_id ON public.time_entries USING btree (schedule_id);


--
-- Name: index_time_entries_on_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_status ON public.time_entries USING btree (status);


--
-- Name: index_time_entries_on_time_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_time_category_id ON public.time_entries USING btree (time_category_id);


--
-- Name: index_time_entries_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_user_id ON public.time_entries USING btree (user_id);


--
-- Name: index_time_entries_on_work_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entries_on_work_date ON public.time_entries USING btree (work_date);


--
-- Name: index_time_entries_one_active_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_time_entries_one_active_per_user ON public.time_entries USING btree (user_id) WHERE ((status)::text = ANY (ARRAY[('clocked_in'::character varying)::text, ('on_break'::character varying)::text]));


--
-- Name: index_time_entry_breaks_on_time_entry_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_time_entry_breaks_on_time_entry_id ON public.time_entry_breaks USING btree (time_entry_id);


--
-- Name: index_time_entry_breaks_one_active_per_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_time_entry_breaks_one_active_per_entry ON public.time_entry_breaks USING btree (time_entry_id) WHERE (end_time IS NULL);


--
-- Name: index_user_approval_groups_on_approval_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_approval_groups_on_approval_group ON public.user_approval_groups USING btree (approval_group);


--
-- Name: index_user_approval_groups_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_approval_groups_on_user_id ON public.user_approval_groups USING btree (user_id);


--
-- Name: index_user_approval_groups_on_user_id_and_approval_group; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_user_approval_groups_on_user_id_and_approval_group ON public.user_approval_groups USING btree (user_id, approval_group);


--
-- Name: index_user_time_categories_on_time_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_time_categories_on_time_category_id ON public.user_time_categories USING btree (time_category_id);


--
-- Name: index_user_time_categories_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_time_categories_on_user_id ON public.user_time_categories USING btree (user_id);


--
-- Name: index_user_time_categories_on_user_id_and_time_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_user_time_categories_on_user_id_and_time_category_id ON public.user_time_categories USING btree (user_id, time_category_id);


--
-- Name: index_users_on_approval_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_approval_group ON public.users USING btree (approval_group);


--
-- Name: index_users_on_clerk_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_clerk_id ON public.users USING btree (clerk_id);


--
-- Name: index_users_on_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_email ON public.users USING btree (email);


--
-- Name: index_users_on_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_is_active ON public.users USING btree (is_active);


--
-- Name: index_users_on_is_intern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_is_intern ON public.users USING btree (is_intern);


--
-- Name: index_users_on_kiosk_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_kiosk_enabled ON public.users USING btree (kiosk_enabled);


--
-- Name: index_users_on_kiosk_locked_until; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_kiosk_locked_until ON public.users USING btree (kiosk_locked_until);


--
-- Name: index_users_on_kiosk_pin_lookup_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_kiosk_pin_lookup_hash ON public.users USING btree (kiosk_pin_lookup_hash);


--
-- Name: index_users_on_lower_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_lower_email ON public.users USING btree (lower((email)::text)) WHERE ((email IS NOT NULL) AND (btrim((email)::text) <> ''::text));


--
-- Name: index_users_on_payroll_integration_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_payroll_integration_uuid ON public.users USING btree (payroll_integration_uuid);


--
-- Name: index_users_on_personal_access_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_personal_access_enabled ON public.users USING btree (personal_access_enabled);


--
-- Name: index_users_on_public_team_visibility_and_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_public_team_visibility_and_sort ON public.users USING btree (public_team_enabled, public_team_sort_order);


--
-- Name: index_users_on_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_role ON public.users USING btree (role);


--
-- Name: index_users_on_time_tracking_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_time_tracking_enabled ON public.users USING btree (time_tracking_enabled);


--
-- Name: audit_logs audit_logs_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_append_only BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.protect_audit_logs_from_mutation();


--
-- Name: payroll_batch_entries payroll_batch_entries_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_batch_entries_append_only BEFORE DELETE OR UPDATE ON public.payroll_batch_entries FOR EACH ROW EXECUTE FUNCTION public.protect_finalized_payroll_records();


--
-- Name: payroll_batch_exclusions payroll_batch_exclusions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_batch_exclusions_append_only BEFORE DELETE OR UPDATE ON public.payroll_batch_exclusions FOR EACH ROW EXECUTE FUNCTION public.protect_finalized_payroll_records();


--
-- Name: payroll_batch_processing_events payroll_batch_processing_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_batch_processing_events_append_only BEFORE DELETE OR UPDATE ON public.payroll_batch_processing_events FOR EACH ROW EXECUTE FUNCTION public.protect_finalized_payroll_records();


--
-- Name: payroll_batches payroll_batches_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_batches_append_only BEFORE DELETE OR UPDATE ON public.payroll_batches FOR EACH ROW EXECUTE FUNCTION public.protect_finalized_payroll_records();


--
-- Name: payroll_calendar_period_revisions payroll_calendar_period_revisions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_calendar_period_revisions_append_only BEFORE DELETE OR UPDATE ON public.payroll_calendar_period_revisions FOR EACH ROW EXECUTE FUNCTION public.protect_payroll_calendar_revision();


--
-- Name: payroll_calendar_periods payroll_calendar_periods_cutoff_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_calendar_periods_cutoff_guard BEFORE DELETE OR UPDATE ON public.payroll_calendar_periods FOR EACH ROW EXECUTE FUNCTION public.protect_payroll_calendar_period_after_cutoff();


--
-- Name: payroll_entry_processing_events payroll_entry_processing_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_entry_processing_events_append_only BEFORE DELETE OR UPDATE ON public.payroll_entry_processing_events FOR EACH ROW EXECUTE FUNCTION public.protect_finalized_payroll_records();


--
-- Name: payroll_integration_commands payroll_integration_commands_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_integration_commands_append_only BEFORE DELETE OR UPDATE ON public.payroll_integration_commands FOR EACH ROW EXECUTE FUNCTION public.protect_payroll_integration_command();


--
-- Name: payroll_integration_commands payroll_integration_commands_prevent_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_integration_commands_prevent_truncate BEFORE TRUNCATE ON public.payroll_integration_commands FOR EACH STATEMENT EXECUTE FUNCTION public.protect_payroll_integration_command();


--
-- Name: payroll_manual_allocation_events payroll_manual_allocation_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_manual_allocation_events_append_only BEFORE DELETE OR UPDATE ON public.payroll_manual_allocation_events FOR EACH ROW EXECUTE FUNCTION public.protect_finalized_payroll_records();


--
-- Name: payroll_manual_allocation_events payroll_manual_allocation_events_prevent_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_manual_allocation_events_prevent_truncate BEFORE TRUNCATE ON public.payroll_manual_allocation_events FOR EACH STATEMENT EXECUTE FUNCTION public.protect_finalized_payroll_records();


--
-- Name: payroll_outbox_events payroll_outbox_events_payload_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_outbox_events_payload_immutable BEFORE DELETE OR UPDATE ON public.payroll_outbox_events FOR EACH ROW EXECUTE FUNCTION public.protect_payroll_outbox_payload();


--
-- Name: payroll_settlement_case_events payroll_settlement_case_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_settlement_case_events_append_only BEFORE DELETE OR UPDATE ON public.payroll_settlement_case_events FOR EACH ROW EXECUTE FUNCTION public.protect_finalized_payroll_records();


--
-- Name: payroll_settlement_case_events payroll_settlement_case_events_prevent_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payroll_settlement_case_events_prevent_truncate BEFORE TRUNCATE ON public.payroll_settlement_case_events FOR EACH STATEMENT EXECUTE FUNCTION public.protect_finalized_payroll_records();


--
-- Name: payroll_manual_allocations fk_rails_086e3c35c2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_manual_allocations
    ADD CONSTRAINT fk_rails_086e3c35c2 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: time_entries fk_rails_1a91ee6a57; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT fk_rails_1a91ee6a57 FOREIGN KEY (time_category_id) REFERENCES public.time_categories(id);


--
-- Name: audit_logs fk_rails_1f26bc34ae; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT fk_rails_1f26bc34ae FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payroll_batch_processing_events fk_rails_2065ea9686; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batch_processing_events
    ADD CONSTRAINT fk_rails_2065ea9686 FOREIGN KEY (payroll_batch_id) REFERENCES public.payroll_batches(id) ON DELETE CASCADE;


--
-- Name: user_approval_groups fk_rails_29637a3180; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_approval_groups
    ADD CONSTRAINT fk_rails_29637a3180 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payroll_batch_entries fk_rails_2daa69183f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batch_entries
    ADD CONSTRAINT fk_rails_2daa69183f FOREIGN KEY (payroll_batch_id) REFERENCES public.payroll_batches(id) ON DELETE CASCADE;


--
-- Name: employee_pay_rates fk_rails_31663a1dca; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pay_rates
    ADD CONSTRAINT fk_rails_31663a1dca FOREIGN KEY (time_category_id) REFERENCES public.time_categories(id);


--
-- Name: solid_queue_recurring_executions fk_rails_318a5533ed; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_executions
    ADD CONSTRAINT fk_rails_318a5533ed FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


--
-- Name: payroll_settlement_reconciliations fk_rails_31d292553b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_reconciliations
    ADD CONSTRAINT fk_rails_31d292553b FOREIGN KEY (payroll_calendar_period_id) REFERENCES public.payroll_calendar_periods(id) ON DELETE RESTRICT;


--
-- Name: payroll_account_link_sessions fk_rails_335464c4c1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_account_link_sessions
    ADD CONSTRAINT fk_rails_335464c4c1 FOREIGN KEY (linked_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: solid_queue_failed_executions fk_rails_39bbc7a631; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_failed_executions
    ADD CONSTRAINT fk_rails_39bbc7a631 FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


--
-- Name: time_entries fk_rails_3afcdd7800; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT fk_rails_3afcdd7800 FOREIGN KEY (approved_by_id) REFERENCES public.users(id);


--
-- Name: payroll_manual_allocations fk_rails_3b16dab34b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_manual_allocations
    ADD CONSTRAINT fk_rails_3b16dab34b FOREIGN KEY (time_entry_id) REFERENCES public.time_entries(id);


--
-- Name: schedules fk_rails_3c900465fa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT fk_rails_3c900465fa FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payroll_outbox_events fk_rails_3ef98dfa9e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_outbox_events
    ADD CONSTRAINT fk_rails_3ef98dfa9e FOREIGN KEY (payroll_calendar_period_id) REFERENCES public.payroll_calendar_periods(id) ON DELETE RESTRICT;


--
-- Name: employee_pay_rates fk_rails_3f5ac92d21; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pay_rates
    ADD CONSTRAINT fk_rails_3f5ac92d21 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: leave_requests fk_rails_4268444d33; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT fk_rails_4268444d33 FOREIGN KEY (cancelled_by_id) REFERENCES public.users(id);


--
-- Name: time_entry_breaks fk_rails_4cb8cc8496; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entry_breaks
    ADD CONSTRAINT fk_rails_4cb8cc8496 FOREIGN KEY (time_entry_id) REFERENCES public.time_entries(id);


--
-- Name: solid_queue_blocked_executions fk_rails_4cd34e2228; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_blocked_executions
    ADD CONSTRAINT fk_rails_4cd34e2228 FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


--
-- Name: user_time_categories fk_rails_51807b7664; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_time_categories
    ADD CONSTRAINT fk_rails_51807b7664 FOREIGN KEY (time_category_id) REFERENCES public.time_categories(id);


--
-- Name: time_entries fk_rails_5a62b64f2d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT fk_rails_5a62b64f2d FOREIGN KEY (overtime_approved_by_id) REFERENCES public.users(id);


--
-- Name: payroll_settlement_cases fk_rails_5fcbd37628; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_cases
    ADD CONSTRAINT fk_rails_5fcbd37628 FOREIGN KEY (origin_payroll_batch_id) REFERENCES public.payroll_batches(id) ON DELETE RESTRICT;


--
-- Name: payroll_batches fk_rails_634c1f225c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batches
    ADD CONSTRAINT fk_rails_634c1f225c FOREIGN KEY (finalized_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_settlement_cases fk_rails_63b2b1283f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_cases
    ADD CONSTRAINT fk_rails_63b2b1283f FOREIGN KEY (origin_payroll_batch_exclusion_id) REFERENCES public.payroll_batch_exclusions(id) ON DELETE RESTRICT;


--
-- Name: payroll_integration_grants fk_rails_6cad167610; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_integration_grants
    ADD CONSTRAINT fk_rails_6cad167610 FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_account_links fk_rails_6f62c05926; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_account_links
    ADD CONSTRAINT fk_rails_6f62c05926 FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: payroll_calendar_periods fk_rails_76b188599e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_calendar_periods
    ADD CONSTRAINT fk_rails_76b188599e FOREIGN KEY (payroll_batch_id) REFERENCES public.payroll_batches(id) ON DELETE RESTRICT;


--
-- Name: payroll_manual_allocations fk_rails_7c0a9e324c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_manual_allocations
    ADD CONSTRAINT fk_rails_7c0a9e324c FOREIGN KEY (recorded_by_id) REFERENCES public.users(id);


--
-- Name: payroll_settlement_cases fk_rails_80fb0295f2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_cases
    ADD CONSTRAINT fk_rails_80fb0295f2 FOREIGN KEY (included_payroll_batch_id) REFERENCES public.payroll_batches(id) ON DELETE RESTRICT;


--
-- Name: solid_queue_ready_executions fk_rails_81fcbd66af; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_ready_executions
    ADD CONSTRAINT fk_rails_81fcbd66af FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


--
-- Name: payroll_settlement_cases fk_rails_8fd3fba472; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_cases
    ADD CONSTRAINT fk_rails_8fd3fba472 FOREIGN KEY (assigned_to_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_entry_processing_events fk_rails_94a8c847a2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_entry_processing_events
    ADD CONSTRAINT fk_rails_94a8c847a2 FOREIGN KEY (payroll_batch_id) REFERENCES public.payroll_batches(id) ON DELETE CASCADE;


--
-- Name: payroll_settlement_case_events fk_rails_98f55c85d5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_case_events
    ADD CONSTRAINT fk_rails_98f55c85d5 FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: active_storage_variant_records fk_rails_993965df05; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_variant_records
    ADD CONSTRAINT fk_rails_993965df05 FOREIGN KEY (blob_id) REFERENCES public.active_storage_blobs(id);


--
-- Name: leave_requests fk_rails_996ad01a40; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT fk_rails_996ad01a40 FOREIGN KEY (reviewed_by_id) REFERENCES public.users(id);


--
-- Name: solid_queue_claimed_executions fk_rails_9cfe4d4944; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_claimed_executions
    ADD CONSTRAINT fk_rails_9cfe4d4944 FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


--
-- Name: payroll_settlement_cases fk_rails_a72c455e9b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_cases
    ADD CONSTRAINT fk_rails_a72c455e9b FOREIGN KEY (supersedes_case_id) REFERENCES public.payroll_settlement_cases(id) ON DELETE RESTRICT;


--
-- Name: user_time_categories fk_rails_ad936d8258; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_time_categories
    ADD CONSTRAINT fk_rails_ad936d8258 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: leave_requests fk_rails_ae3b26a732; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT fk_rails_ae3b26a732 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payroll_settlement_case_events fk_rails_aee89cc6b6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_case_events
    ADD CONSTRAINT fk_rails_aee89cc6b6 FOREIGN KEY (payroll_settlement_case_id) REFERENCES public.payroll_settlement_cases(id) ON DELETE RESTRICT;


--
-- Name: time_entries fk_rails_b471d1824b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT fk_rails_b471d1824b FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payroll_manual_allocation_events fk_rails_bde813144c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_manual_allocation_events
    ADD CONSTRAINT fk_rails_bde813144c FOREIGN KEY (payroll_manual_allocation_id) REFERENCES public.payroll_manual_allocations(id);


--
-- Name: site_media fk_rails_bf8870d145; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_media
    ADD CONSTRAINT fk_rails_bf8870d145 FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id);


--
-- Name: active_storage_attachments fk_rails_c3b3935057; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_attachments
    ADD CONSTRAINT fk_rails_c3b3935057 FOREIGN KEY (blob_id) REFERENCES public.active_storage_blobs(id);


--
-- Name: solid_queue_scheduled_executions fk_rails_c4316f352d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_scheduled_executions
    ADD CONSTRAINT fk_rails_c4316f352d FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


--
-- Name: report_exports fk_rails_c507e69606; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_exports
    ADD CONSTRAINT fk_rails_c507e69606 FOREIGN KEY (generated_by_id) REFERENCES public.users(id);


--
-- Name: payroll_batch_exclusions fk_rails_ce85143575; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_batch_exclusions
    ADD CONSTRAINT fk_rails_ce85143575 FOREIGN KEY (payroll_batch_id) REFERENCES public.payroll_batches(id) ON DELETE CASCADE;


--
-- Name: payroll_calendar_period_revisions fk_rails_d376da3b87; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_calendar_period_revisions
    ADD CONSTRAINT fk_rails_d376da3b87 FOREIGN KEY (payroll_calendar_period_id) REFERENCES public.payroll_calendar_periods(id) ON DELETE RESTRICT;


--
-- Name: time_entries fk_rails_e358f238b8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT fk_rails_e358f238b8 FOREIGN KEY (schedule_id) REFERENCES public.schedules(id);


--
-- Name: schedules fk_rails_e5a6d0fc5e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT fk_rails_e5a6d0fc5e FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: payroll_manual_allocation_events fk_rails_f249ad28c0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_manual_allocation_events
    ADD CONSTRAINT fk_rails_f249ad28c0 FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: payroll_settlement_cases fk_rails_f9c6b16c38; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_settlement_cases
    ADD CONSTRAINT fk_rails_f9c6b16c38 FOREIGN KEY (target_payroll_calendar_period_id) REFERENCES public.payroll_calendar_periods(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('20260920030000'),
('20260920020000'),
('20260920010000'),
('20260915010000'),
('20260914010000'),
('20260913030000'),
('20260913020000'),
('20260913010000'),
('20260904011000'),
('20260904010000'),
('20260902010000'),
('20260831011000'),
('20260831010000'),
('20260830151000'),
('20260830150000'),
('20260829013000'),
('20260829012000'),
('20260829011000'),
('20260829010000'),
('20260817010000'),
('20260617173000'),
('20260611010000'),
('20260527020000'),
('20260527010000'),
('20260507010000'),
('20260430010100'),
('20260430010000'),
('20260428121000'),
('20260427010000'),
('20260424030000'),
('20260423021500'),
('20260423010000'),
('20260409061342'),
('20260404062229'),
('20260404062220'),
('20260402183000'),
('20260402010000'),
('20260331224854'),
('20260331224038'),
('20260331162100'),
('20260331162000'),
('20260330032000'),
('20260324000001'),
('20260322101903'),
('20260322091714'),
('20260320223356'),
('20260320073043'),
('20260320055835'),
('20260320054555'),
('20260320012308'),
('20260319090936'),
('20260319090928'),
('20260319090918'),
('20260318140716'),
('20260318120000'),
('20260318051325'),
('20260318051138'),
('20260228011100'),
('20260228011000'),
('20260228004000'),
('20260228003000'),
('20260228002000'),
('20260227100000'),
('20260226145500'),
('20260226141422'),
('20260208010002'),
('20260208010001'),
('20260208010000'),
('20260131010653'),
('20260131004931'),
('20260131004912'),
('20260131004858'),
('20260131004842'),
('20260127062045'),
('20260127053940'),
('20260125074154'),
('20260125065644'),
('20260124002234'),
('20260120051147'),
('20260119105151'),
('20260119105130'),
('20260119105113'),
('20260119105056'),
('20260119105038'),
('20260119105032'),
('20260119105011'),
('20260119105006'),
('20260119105001'),
('20260119104955'),
('20260119104947'),
('20260119104942');
