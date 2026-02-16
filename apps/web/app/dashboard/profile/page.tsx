"use client";

import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useWorkshopAuth } from "@/lib/workshop-auth";
import ProfileForm from "./ProfileForm";

interface MeData {
  me: { userId: string; email: string; firstName: string; lastName: string };
}

const ME_QUERY = gql`
  query Me {
    me {
      userId
      email
      firstName
      lastName
    }
  }
`;

export default function ProfilePage() {
  const router = useRouter();
  const { isAuthenticated } = useWorkshopAuth();

  const { data, loading } = useQuery<MeData>(ME_QUERY, {
    skip: !isAuthenticated,
  });

  if (!isAuthenticated) {
    router.push("/");
    return null;
  }

  const userData = data?.me;

  return (
    <div className="p-10">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">Edit Profile</h1>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <ProfileForm
            userId={userData?.userId}
            initialFirstName={userData?.firstName || ""}
            initialLastName={userData?.lastName || ""}
          />
        )}

        <a
          href="/dashboard"
          className="inline-block mt-6 text-blue-600 hover:text-blue-800"
        >
          &larr; Back to Dashboard
        </a>
      </div>
    </div>
  );
}
