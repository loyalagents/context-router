'use client';

import { useState } from 'react';
import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';

const UPDATE_USER_MUTATION = gql`
  mutation UpdateUser($updateUserInput: UpdateUserInput!) {
    updateUser(updateUserInput: $updateUserInput) {
      userId
      firstName
      lastName
    }
  }
`;

interface ProfileFormProps {
  userId?: string;
  initialFirstName: string;
  initialLastName: string;
}

export default function ProfileForm({ userId, initialFirstName, initialLastName }: ProfileFormProps) {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [successMessage, setSuccessMessage] = useState('');

  const [updateUser, { loading, error }] = useMutation(UPDATE_USER_MUTATION, {
    onCompleted: () => {
      setSuccessMessage('Profile updated successfully!');
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage('');

    await updateUser({
      variables: {
        updateUserInput: {
          userId,
          firstName,
          lastName,
        },
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="p-6 border rounded-lg bg-white shadow-sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
              First Name
            </label>
            <input
              type="text"
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={1}
            />
          </div>

          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
              Last Name
            </label>
            <input
              type="text"
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={1}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">
            Error updating profile: {error.message}
          </div>
        )}

        {successMessage && (
          <div className="mt-4 p-3 bg-green-100 text-green-700 rounded">
            {successMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
