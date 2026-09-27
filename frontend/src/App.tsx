import { useEffect, useState } from "react";

type HealthResponse = {
  status: string;
  database: string;
};

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [isAvailable, setIsAvailable] = useState(true);

  useEffect(() => {
    fetch("/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Health check failed");
        }
        return response.json() as Promise<HealthResponse>;
      })
      .then(setHealth)
      .catch(() => setIsAvailable(false));
  }, []);

  return (
    <main>
      <p className="eyebrow">DOGFOOD</p>
      <h1>Application foundation</h1>
      <p className="description">The local platform stack is ready for development.</p>
      <p className="health" role="status">
        {health
          ? `API ${health.status} · Database ${health.database}`
          : isAvailable
            ? "Checking local services..."
            : "Local services are unavailable"}
      </p>
    </main>
  );
}