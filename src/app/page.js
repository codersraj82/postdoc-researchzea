import AiMatchingPreview from "@/components/AiMatchingPreview";
import EmailAlertsPreview from "@/components/EmailAlertsPreview";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import PostdocSearch from "@/components/PostdocSearch";
import { getSampleJobs } from "@/data/sampleJobs";

export default function HomePage() {
  const referenceDate = new Date();
  const jobs = getSampleJobs(referenceDate);

  return (
    <div id="top" className="min-h-screen overflow-x-clip">
      <Header />
      <main>
        <HeroSection />
        <PostdocSearch jobs={jobs} referenceDate={referenceDate.toISOString()} />
        <EmailAlertsPreview />
        <AiMatchingPreview />
      </main>
      <Footer />
    </div>
  );
}
