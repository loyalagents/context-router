export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-4xl font-bold mb-4 text-gray-900">
          Context Router
        </h1>
        <p className="text-lg text-gray-600 mb-8">
          Welcome to the Context Router monorepo application
        </p>
        <div className="space-y-4">
          <div className="p-4 bg-white rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-2 text-gray-900">Frontend</h2>
            <p className="text-gray-600">Next.js 14 with TypeScript and Tailwind CSS</p>
          </div>
          <div className="p-4 bg-white rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-2 text-gray-900">Backend</h2>
            <p className="text-gray-600">NestJS GraphQL API running on port 3000</p>
          </div>
        </div>
      </div>
    </div>
  );
}
