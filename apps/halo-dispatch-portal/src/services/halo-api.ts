import { tables } from "bifrost";

import type {
  ClientCache,
  CreateTicketPayload,
  GetAgentsParams,
  GetCategoriesParams,
  GetClientCacheParams,
  GetSitesParams,
  GetSitesResponse,
  GetTeamsParams,
  HaloAgent,
  HaloAppointment,
  HaloAppointmentType,
  HaloCategory,
  HaloStatus,
  HaloTeam,
  HaloTicketArea,
  HaloTicketType,
  SearchUsersParams,
  SearchUsersResponse,
  Ticket,
  TicketsResponse,
  ViewFilter,
  ViewList,
} from "@/types/halo";

type WorkflowRun<T = unknown> = (input?: Record<string, unknown>) => Promise<T>;

interface HaloWorkflowClient {
  refreshCache: WorkflowRun;
  environment: WorkflowRun;
  listTickets: WorkflowRun<TicketsResponse>;
  listAppointments: WorkflowRun<HaloAppointment[]>;
  searchUsers: WorkflowRun<SearchUsersResponse>;
  searchSites: WorkflowRun<GetSitesResponse>;
  searchCompanies: WorkflowRun;
  saveTicket: WorkflowRun<Ticket[]>;
  saveAppointment: WorkflowRun<HaloAppointment[]>;
  removeAppointment: WorkflowRun<{ deleted: boolean }>;
}

let workflowClient: HaloWorkflowClient | null = null;

export function configureHaloWorkflowClient(client: HaloWorkflowClient) {
  workflowClient = client;
}

function workflows(): HaloWorkflowClient {
  if (!workflowClient) throw new Error("Halo workflow client is not ready");
  return workflowClient;
}

async function readCache<T>(
  tableName: string,
  where?: Record<string, unknown>,
): Promise<T[]> {
  const result = await tables.query(tableName, {
    where,
    order_by: "updated_at",
    order_dir: "desc",
    limit: 1000,
  });
  return result.documents.map((document) => document.data as T);
}

export async function refreshReferenceCache(
  cacheType: string,
  reason = "cache_miss",
  ids: number[] = [],
): Promise<void> {
  await workflows().refreshCache({ cache_type: cacheType, reason, ids });
}

export async function getClientCache(
  _params: GetClientCacheParams = { iscachebuild: true },
): Promise<ClientCache> {
  const [agents, statuses, tickettypes, ticketareas] = await Promise.all([
    readCache<HaloAgent>("halo_dispatch_agents"),
    readCache<HaloStatus>("halo_dispatch_statuses"),
    readCache<HaloTicketType>("halo_dispatch_ticket_types"),
    readCache<HaloTicketArea>("halo_dispatch_ticket_areas"),
  ]);
  return {
    agent: agents[0],
    agents,
    statuses,
    tickettypes,
    ticketareas: ticketareas.sort((a, b) => a.sequence - b.sequence),
    fieldinfos: [],
  };
}

export async function getViewLists(ticketAreaId: number, _utcOffset = 0): Promise<ViewList[]> {
  const rows = await readCache<ViewList>("halo_dispatch_view_lists", {
    ticket_area_id: ticketAreaId,
  });
  return rows.sort((a, b) => (a.group_seq - b.group_seq) || (a.sequence - b.sequence));
}

export async function getViewFilter(_ticketAreaId: number): Promise<ViewFilter[]> {
  return [];
}

export async function getTickets(
  listId: number,
  ticketAreaId: number,
  pageNo = 1,
  pageSize = 100,
  columnsId?: number,
  utcOffset = 0,
): Promise<TicketsResponse> {
  return workflows().listTickets({
    list_id: listId,
    ticket_area_id: ticketAreaId,
    page_no: pageNo,
    page_size: pageSize,
    columns_id: columnsId,
    utc_offset: utcOffset,
  });
}

export function getUtcOffset(): number {
  return -new Date().getTimezoneOffset();
}

export function getAgentPhotoUrl(resourceServer: string, agentPhotoPath?: string): string | null {
  if (!resourceServer || !agentPhotoPath) return null;
  const baseUrl = resourceServer.replace(/\/$/, "");
  if (agentPhotoPath.startsWith("http")) return agentPhotoPath;
  return `${baseUrl}${agentPhotoPath.startsWith("/api") ? "" : "/api"}${agentPhotoPath}`;
}

export async function getAppointmentTypes(): Promise<HaloAppointmentType[]> {
  return readCache<HaloAppointmentType>("halo_dispatch_appointment_types");
}

export async function getAppointments(
  startDate: string,
  endDate: string,
  agentIds?: number[],
  utcOffset?: number,
): Promise<HaloAppointment[]> {
  return workflows().listAppointments({
    start_date: startDate,
    end_date: endDate,
    agent_ids: agentIds ?? [],
    utc_offset: utcOffset ?? getUtcOffset(),
  });
}

export async function createOrUpdateAppointment(
  appointment: Partial<HaloAppointment> & { id?: number },
): Promise<HaloAppointment[]> {
  return workflows().saveAppointment({ appointment });
}

export async function deleteAppointment(appointmentId: number): Promise<void> {
  await workflows().removeAppointment({ appointment_id: appointmentId });
}

export async function searchUsers(params: SearchUsersParams = {}): Promise<SearchUsersResponse> {
  return workflows().searchUsers({ search: params.search ?? "", count: params.count ?? 50 });
}

export async function getCategories(_params: GetCategoriesParams): Promise<HaloCategory[]> {
  return readCache<HaloCategory>("halo_dispatch_categories");
}

export async function getTeams(_params: GetTeamsParams = {}): Promise<HaloTeam[]> {
  const rows = await readCache<HaloTeam>("halo_dispatch_teams");
  return rows.filter((team) => team.forrequests && !team.inactive);
}

export async function getAgents(params: GetAgentsParams = {}): Promise<HaloAgent[]> {
  const rows = await readCache<HaloAgent>("halo_dispatch_agents");
  return rows.filter((agent) => {
    if (agent.isdisabled || agent.isapiagent) return false;
    if (params.team && agent.team !== params.team) return false;
    return true;
  });
}

export async function getSites(params: GetSitesParams = {}): Promise<GetSitesResponse> {
  return workflows().searchSites({
    search: params.search ?? "",
    page_no: params.page_no ?? 1,
    page_size: params.page_size ?? 100,
  });
}

export async function searchCompanies(search = "", pageNo = 1, pageSize = 100) {
  return workflows().searchCompanies({ search, page_no: pageNo, page_size: pageSize });
}

export async function createOrUpdateTicket(ticketData: CreateTicketPayload): Promise<Ticket[]> {
  return workflows().saveTicket({ ticket: ticketData });
}
