import { createFileRoute } from "@tanstack/react-router";
import { Scriptorium } from "@/components/scriptorium";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Scriptorium />;
}
