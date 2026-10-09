import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkflow } from "bifrost";

import { ApiErrorPage } from "@/components/ApiErrorPage";
import { LoadingScreen } from "@/components/LoadingScreen";
import { configureHaloWorkflowClient } from "@/services/halo-api";
import { useConfigStore } from "@/stores/configStore";
import { useDispatchStore } from "@/stores/useDispatchStore";
import type {
  GetSitesResponse,
  HaloAppointment,
  SearchUsersResponse,
  Ticket,
  TicketsResponse,
} from "@/types/halo";

export function HaloWorkflowBridge({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const initializationRef = useRef<Promise<void> | null>(null);
  const refreshCache = useWorkflow("functions/halo_dispatch.py::refresh_cache");
  const environment = useWorkflow<{ halo_base_url: string }>("functions/halo_dispatch.py::environment");
  const environmentRunRef = useRef(environment.run);
  environmentRunRef.current = environment.run;
  const listTickets = useWorkflow<TicketsResponse>("functions/halo_dispatch.py::list_tickets");
  const listAppointments = useWorkflow<HaloAppointment[]>("functions/halo_dispatch.py::list_appointments");
  const searchUsers = useWorkflow<SearchUsersResponse>("functions/halo_dispatch.py::search_users");
  const searchSites = useWorkflow<GetSitesResponse>("functions/halo_dispatch.py::search_sites");
  const searchCompanies = useWorkflow("functions/halo_dispatch.py::search_companies");
  const saveTicket = useWorkflow<Ticket[]>("functions/halo_dispatch.py::save_ticket");
  const saveAppointment = useWorkflow<HaloAppointment[]>("functions/halo_dispatch.py::save_appointment");
  const removeAppointment = useWorkflow<{ deleted: boolean }>("functions/halo_dispatch.py::remove_appointment");

  configureHaloWorkflowClient({
    refreshCache: refreshCache.run,
    environment: environment.run,
    listTickets: listTickets.run,
    listAppointments: listAppointments.run,
    searchUsers: searchUsers.run,
    searchSites: searchSites.run,
    searchCompanies: searchCompanies.run,
    saveTicket: saveTicket.run,
    saveAppointment: saveAppointment.run,
    removeAppointment: removeAppointment.run,
  });

  const initialize = useCallback(() => {
    setStatus("loading");
    useDispatchStore.getState().clearCriticalApiError();

    const request = environmentRunRef.current()
      .then((result) => {
        useConfigStore.getState().setResourceServer(result.halo_base_url ?? "");
        setStatus("ready");
      })
      .catch((error) => {
        useDispatchStore.getState().setCriticalApiError(
          "Unable to initialize Halo Dispatch Portal",
          error instanceof Error ? error.message : String(error),
        );
        setStatus("error");
      })
      .finally(() => {
        initializationRef.current = null;
      });

    initializationRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!initializationRef.current) {
      void initialize();
    }
  }, [initialize]);

  if (status === "loading") {
    return <LoadingScreen message="Connecting to Halo..." />;
  }

  if (status === "error") {
    return <ApiErrorPage onRetry={() => void initialize()} />;
  }

  return children;
}
