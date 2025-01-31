interface User {
  name: string;
  age: number;
  address?: Address;
}

interface Address {
  street: string;
  city?: string | number;
  country?: string;
}

/**
 * @description Fetch the token balance for a user based on their username and token details.
 * @param user The user. This can be a wallet address, Discord ID, etc.
 * @param token The token to search for, which can be its symbol, address, or name.
 */
export async function getUserTokenBalance({
  user,
  token,
}: {
  user: User;
  token: number;
}): Promise<void> {}

/**
 * @description Just testing a new function
 * @param param1 this is the description for param1
 * @param param2 this is the description for param2
 */
const thisIsANewFunction = async ({
  param1,
  param2,
}: {
  param1: string;
  param2: number;
}) => {};
