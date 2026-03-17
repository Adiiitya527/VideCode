import Image from "next/image";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";

export default async function Home() {
  return (
    <div>
      <Button>
        Get Started
      </Button>
    </div>
  );
}
