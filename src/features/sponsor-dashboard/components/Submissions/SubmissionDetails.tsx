import { ArrowForwardIcon, CopyIcon, ExternalLinkIcon } from '@chakra-ui/icons';
import {
  Box,
  Button,
  Flex,
  Image,
  Link,
  Select,
  Spinner,
  Text,
  Tooltip,
} from '@chakra-ui/react';
import type NodeWallet from '@coral-xyz/anchor/dist/cjs/nodewallet';
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import axios from 'axios';
import Avatar from 'boring-avatars';
import dynamic from 'next/dynamic';
import NextLink from 'next/link';
import React, { type Dispatch, type SetStateAction, useState } from 'react';
import { BsTwitterX } from 'react-icons/bs';
import {
  MdArrowDropDown,
  MdOutlineAccountBalanceWallet,
  MdOutlineMail,
} from 'react-icons/md';

import { tokenList } from '@/constants';
import type { Bounty, Rewards } from '@/features/listings';
import type { SubmissionWithUser } from '@/interface/submission';
import {
  connection,
  createPaymentSOL,
  createPaymentSPL,
} from '@/utils/contract/contract';
import { getURLSanitized } from '@/utils/getURLSanitized';
import { truncatePublicKey } from '@/utils/truncatePublicKey';

interface Props {
  bounty: Bounty | null;
  submissions: SubmissionWithUser[];
  setSubmissions: Dispatch<SetStateAction<SubmissionWithUser[]>>;
  selectedSubmission: SubmissionWithUser | undefined;
  setSelectedSubmission: Dispatch<
    SetStateAction<SubmissionWithUser | undefined>
  >;
  setTotalWinners: Dispatch<SetStateAction<number>>;
  rewards: string[];
  usedPositions: string[];
  setUsedPositions: Dispatch<SetStateAction<string[]>>;
  setTotalPaymentsMade: Dispatch<SetStateAction<number>>;
  isHackathonPage?: boolean;
}

export const SubmissionDetails = ({
  bounty,
  submissions,
  setSubmissions,
  selectedSubmission,
  setSelectedSubmission,
  setTotalWinners,
  rewards,
  usedPositions,
  setUsedPositions,
  setTotalPaymentsMade,
  isHackathonPage,
}: Props) => {
  const [isSelectingWinner, setIsSelectingWinner] = useState(false);
  const [isPaying, setIsPaying] = useState(false);

  const { connected, publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();

  const isProject = bounty?.type === 'project';
  const isHackathon = bounty?.type === 'hackathon';

  const DynamicWalletMultiButton = dynamic(
    async () =>
      (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
    { ssr: false },
  );

  const selectWinner = async (
    position: string,
    id: string | undefined,
    ask: number | undefined,
  ) => {
    if (!id) return;
    setIsSelectingWinner(true);
    try {
      await axios.post(`/api/submission/toggleWinner/`, {
        id,
        isWinner: !!position,
        winnerPosition: position || null,
        ask: ask,
      });

      const submissionIndex = submissions.findIndex((s) => s.id === id);
      if (submissionIndex >= 0) {
        const oldRank: string =
          submissions[submissionIndex]?.winnerPosition || '';

        let newUsedPositions = [...usedPositions];
        if (oldRank && oldRank !== position) {
          newUsedPositions = newUsedPositions.filter((pos) => pos !== oldRank);
        }

        if (position && !newUsedPositions.includes(position)) {
          newUsedPositions.push(position);
        }
        setUsedPositions(newUsedPositions);

        const updatedSubmission: SubmissionWithUser = {
          ...(submissions[submissionIndex] as SubmissionWithUser),
          isWinner: !!position,
          winnerPosition: (position as keyof Rewards) || undefined,
        };
        const newSubmissions = [...submissions];
        newSubmissions[submissionIndex] = updatedSubmission;
        setSubmissions(newSubmissions);
        setSelectedSubmission(updatedSubmission);
        setTotalWinners(newUsedPositions.length);
      }
      setIsSelectingWinner(false);
    } catch (e) {
      setIsSelectingWinner(false);
    }
  };

  const handlePayout = async ({
    id,
    token,
    amount,
    receiver,
  }: {
    id: string;
    token: string;
    amount: number;
    receiver: PublicKey;
  }) => {
    setIsPaying(true);
    let sig = '';
    try {
      const power = tokenList.find((e) => e.tokenSymbol === token)
        ?.decimals as number;
      const tokenAddress = tokenList.find((e) => e.tokenSymbol === token)
        ?.mintAddress as string;
      if (token === 'SOL') {
        const ix = await createPaymentSOL(
          anchorWallet as NodeWallet,
          receiver,
          amount,
          JSON.stringify(Math.floor(Math.random() * 1000000000)),
        );
        const tx = new Transaction();
        tx.add(ix);
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = (anchorWallet as NodeWallet).publicKey;
        const signTx = await anchorWallet?.signTransaction(tx);
        sig = await connection.sendRawTransaction(signTx!.serialize());
      } else {
        const [ix, ix2] = await createPaymentSPL(
          anchorWallet as NodeWallet,
          receiver,
          (amount * 10 ** power) as number,
          new PublicKey(tokenAddress as string),
          JSON.stringify(Math.floor(Math.random() * 10000)),
        );
        const tx = new Transaction();
        if (ix2) {
          tx.add(ix2 as TransactionInstruction);
        }
        tx.add(ix as TransactionInstruction);
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = (anchorWallet as NodeWallet).publicKey;
        const signTx = await anchorWallet?.signTransaction(tx);
        sig = await connection.sendRawTransaction(signTx!.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
          preflightCommitment: 'confirmed',
        });
      }
      await new Promise((resolve, reject) => {
        connection.onSignature(
          sig,
          (res) => {
            if (res.err) {
              reject(new Error('Transaction failed'));
            } else {
              resolve(res);
            }
          },
          'confirmed',
        );
      });

      await axios.post(`/api/submission/addPayment/`, {
        id,
        amount,
        isPaid: true,
        paymentDetails: {
          txId: sig,
        },
      });
      const submissionIndex = submissions.findIndex((s) => s.id === id);
      if (submissionIndex >= 0) {
        const updatedSubmission: SubmissionWithUser = {
          ...(submissions[submissionIndex] as SubmissionWithUser),
          isPaid: true,
          paymentDetails: {
            txId: sig,
          },
        };
        const newSubmissions = [...submissions];
        newSubmissions[submissionIndex] = updatedSubmission;
        setSubmissions(newSubmissions);
        setSelectedSubmission(updatedSubmission);
        setTotalPaymentsMade(
          (prevTotalPaymentsMade: number) => prevTotalPaymentsMade + 1,
        );
      }
      setIsPaying(false);
    } catch (error) {
      console.log(error);
      setIsPaying(false);
    }
  };

  return (
    <>
      <Box
        w="150%"
        p={1.5}
        bg="white"
        borderColor="brand.slate.200"
        borderTopWidth="1px"
        borderRightWidth={'1px'}
        borderBottomWidth="1px"
        roundedRight={'xl'}
      >
        {submissions.length ? (
          <>
            <Flex
              align="center"
              justify={'space-between'}
              w="full"
              px={4}
              py={3}
            >
              <Flex align="center" gap={2} w="full">
                {selectedSubmission?.user?.photo ? (
                  <Image
                    w="40px"
                    h="40px"
                    borderRadius="full"
                    objectFit={'cover'}
                    alt={`${selectedSubmission?.user?.firstName} ${selectedSubmission?.user?.lastName}`}
                    src={selectedSubmission?.user?.photo}
                  />
                ) : (
                  <Avatar
                    name={`${selectedSubmission?.user?.firstName} ${selectedSubmission?.user?.lastName}`}
                    colors={['#92A1C6', '#F0AB3D', '#C271B4']}
                    size={40}
                    variant="marble"
                  />
                )}
                <Box>
                  <Text
                    w="100%"
                    color="brand.slate.900"
                    fontSize="md"
                    fontWeight={500}
                    whiteSpace={'nowrap'}
                  >
                    {`${selectedSubmission?.user?.firstName}'s Submission`}
                  </Text>
                  <Text
                    w="100%"
                    color="brand.purple"
                    fontSize="xs"
                    fontWeight={500}
                    whiteSpace={'nowrap'}
                  >
                    View Profile <ArrowForwardIcon mb="0.5" />
                  </Text>
                </Box>
              </Flex>
              <Flex align="center" justify={'flex-end'} gap={2} w="full">
                {selectedSubmission?.isWinner &&
                  selectedSubmission?.winnerPosition &&
                  !selectedSubmission?.isPaid &&
                  (bounty?.isWinnersAnnounced ? (
                    <>
                      <DynamicWalletMultiButton
                        style={{
                          height: '40px',
                          fontWeight: 600,
                          fontFamily: 'Inter',
                          // maxWidth: '96px',
                          paddingRight: '16px',
                          paddingLeft: '16px',
                          fontSize: '12px',
                        }}
                      >
                        {connected
                          ? truncatePublicKey(publicKey?.toBase58(), 3)
                          : `Pay ${bounty?.token} ${
                              bounty?.rewards?.[
                                selectedSubmission?.winnerPosition as keyof Rewards
                              ] || '0'
                            }`}
                      </DynamicWalletMultiButton>
                      {connected && (
                        <Button
                          w="fit-content"
                          minW={'120px'}
                          mr={4}
                          isDisabled={!bounty?.isWinnersAnnounced}
                          isLoading={isPaying}
                          loadingText={'Paying...'}
                          onClick={async () => {
                            if (!selectedSubmission?.user.publicKey) {
                              console.error(
                                'Public key is null, cannot proceed with payment',
                              );
                              return;
                            }
                            handlePayout({
                              id: selectedSubmission?.id as string,
                              token: bounty?.token as string,
                              amount: bounty?.rewards![
                                selectedSubmission?.winnerPosition as keyof Rewards
                              ] as number,
                              receiver: new PublicKey(
                                selectedSubmission.user.publicKey,
                              ),
                            });
                          }}
                          size="md"
                          variant="solid"
                        >
                          Pay {bounty?.token}{' '}
                          {!!bounty?.rewards &&
                            bounty?.rewards[
                              selectedSubmission?.winnerPosition as keyof Rewards
                            ]}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Tooltip
                        bg={'brand.purple'}
                        hasArrow={true}
                        isDisabled={!!bounty?.isWinnersAnnounced}
                        label="You have to publish the results before you can pay out rewards!"
                        placement="top"
                      >
                        <Button
                          mr={4}
                          isDisabled={!bounty?.isWinnersAnnounced}
                          size="sm"
                          variant="solid"
                        >
                          Pay {bounty?.token}{' '}
                          {!!bounty?.rewards &&
                            bounty?.rewards[
                              selectedSubmission?.winnerPosition as keyof Rewards
                            ]}
                        </Button>
                      </Tooltip>
                    </>
                  ))}
                {selectedSubmission?.isWinner &&
                  selectedSubmission?.winnerPosition &&
                  selectedSubmission?.isPaid && (
                    <Button
                      mr={4}
                      onClick={() => {
                        window.open(
                          `https://solscan.io/tx/${selectedSubmission?.paymentDetails?.txId}?cluster=${process.env.NEXT_PUBLIC_PAYMENT_CLUSTER}`,
                          '_blank',
                        );
                      }}
                      rightIcon={<ExternalLinkIcon />}
                      size="md"
                      variant="ghost"
                    >
                      View Payment Txn
                    </Button>
                  )}
                {isSelectingWinner && (
                  <Spinner color="brand.slate.400" size="sm" />
                )}
                {!bounty?.isWinnersAnnounced && (
                  <Select
                    minW={44}
                    maxW={44}
                    color="brand.slate.500"
                    fontWeight={500}
                    textTransform="capitalize"
                    borderColor="brand.slate.300"
                    _placeholder={{ color: 'brand.slate.300' }}
                    focusBorderColor="brand.purple"
                    icon={<MdArrowDropDown />}
                  >
                    <option value={'Unreviewed'}>Unreviewed</option>
                    <option value={'Reviewed'}>Reviewed</option>
                    <option value={'ShortListed'}>Shortlisted</option>
                    <option value={'Not a Winner'}>Not a Winner</option>
                    <option value={'Spam'}>Spam</option>
                  </Select>
                )}
                {!bounty?.isWinnersAnnounced && (
                  <Tooltip
                    bg={'brand.purple'}
                    hasArrow={true}
                    isDisabled={!bounty?.isWinnersAnnounced}
                    label="You cannot change the winners once the results are published!"
                    placement="top"
                  >
                    <Select
                      minW={44}
                      maxW={44}
                      color="brand.slate.500"
                      fontWeight={500}
                      textTransform="capitalize"
                      borderColor="brand.slate.300"
                      _placeholder={{ color: 'brand.slate.300' }}
                      focusBorderColor="brand.purple"
                      icon={<MdArrowDropDown />}
                      isDisabled={
                        !!bounty?.isWinnersAnnounced || isHackathonPage
                      }
                      onChange={(e) =>
                        selectWinner(
                          e.target.value,
                          selectedSubmission?.id,
                          selectedSubmission?.ask,
                        )
                      }
                      value={
                        selectedSubmission?.isWinner
                          ? selectedSubmission.winnerPosition || ''
                          : ''
                      }
                    >
                      <option value={''}>Select Winner</option>
                      {rewards.map((reward) => {
                        const isRewardUsed = usedPositions.includes(reward);
                        const isCurrentSubmissionReward =
                          selectedSubmission?.winnerPosition === reward;
                        return (
                          (!isRewardUsed || isCurrentSubmissionReward) && (
                            <option key={reward} value={reward}>
                              {isProject ? 'Winner' : reward}
                            </option>
                          )
                        );
                      })}
                    </Select>
                  </Tooltip>
                )}
              </Flex>
            </Flex>

            <Flex align="center" gap={5} px={6} py={2}>
              {selectedSubmission?.user?.email && (
                <Flex align="center" justify="start" gap={2} fontSize="sm">
                  <MdOutlineMail color="#94A3B8" />
                  <Link
                    color="brand.slate.400"
                    href={`mailto:${selectedSubmission.user.email}`}
                    isExternal
                  >
                    {selectedSubmission?.user?.email}
                  </Link>
                </Flex>
              )}
              {selectedSubmission?.user?.publicKey && (
                <Flex align="center" justify="start" gap={2} fontSize="sm">
                  <MdOutlineAccountBalanceWallet color="#94A3B8" />
                  <Text color="brand.slate.400">
                    {truncatePublicKey(selectedSubmission?.user?.publicKey, 4)}
                    <Tooltip label="Copy Wallet ID" placement="right">
                      <CopyIcon
                        cursor="pointer"
                        ml={1}
                        color="brand.slate.400"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            selectedSubmission?.user?.publicKey || '',
                          )
                        }
                      />
                    </Tooltip>
                  </Text>
                </Flex>
              )}
              {selectedSubmission?.user?.twitter && (
                <Flex align="center" justify="start" gap={2} fontSize="sm">
                  <BsTwitterX color="#94A3B8" />

                  <Link
                    color="brand.slate.400"
                    href={getURLSanitized(
                      selectedSubmission?.user?.twitter?.replace(
                        'twitter.com',
                        'x.com',
                      ) || '#',
                    )}
                    isExternal
                  >
                    {selectedSubmission?.user?.twitter?.replace(
                      'twitter.com',
                      'x.com',
                    ) || '-'}
                  </Link>
                </Flex>
              )}
            </Flex>

            <Box w="full" px={4} py={5}>
              {!isProject && (
                <>
                  <Box mb={4}>
                    <Text
                      mb={1}
                      color="brand.slate.400"
                      fontSize="xs"
                      fontWeight={600}
                      textTransform={'uppercase'}
                    >
                      Main Submission
                    </Text>
                    <Link
                      as={NextLink}
                      color="brand.purple"
                      wordBreak={'break-all'}
                      href={getURLSanitized(selectedSubmission?.link || '#')}
                      isExternal
                    >
                      {selectedSubmission?.link
                        ? getURLSanitized(selectedSubmission?.link)
                        : '-'}
                    </Link>
                  </Box>
                  <Box mb={4}>
                    <Text
                      mb={1}
                      color="brand.slate.400"
                      fontSize="xs"
                      fontWeight={600}
                      textTransform={'uppercase'}
                    >
                      Tweet Link
                    </Text>
                    <Link
                      as={NextLink}
                      color="brand.purple"
                      wordBreak={'break-all'}
                      href={getURLSanitized(selectedSubmission?.tweet || '#')}
                      isExternal
                    >
                      {selectedSubmission?.tweet
                        ? getURLSanitized(selectedSubmission?.tweet)
                        : '-'}
                    </Link>
                  </Box>
                </>
              )}
              {bounty?.compensationType !== 'fixed' && (
                <Box mb={4}>
                  <Text
                    mb={1}
                    color="brand.slate.400"
                    fontSize="xs"
                    fontWeight={600}
                    textTransform={'uppercase'}
                  >
                    Ask
                  </Text>
                  <Text color="brand.slate.700" wordBreak={'break-all'}>
                    {selectedSubmission?.ask?.toLocaleString()} {bounty?.token}
                  </Text>
                </Box>
              )}

              {(isProject || isHackathon) &&
                selectedSubmission?.eligibilityAnswers?.map(
                  (answer: any, answerIndex: number) => (
                    <Box key={answerIndex} mb={4}>
                      <Text
                        mb={1}
                        color="brand.slate.400"
                        fontSize="xs"
                        fontWeight={600}
                        textTransform={'uppercase'}
                      >
                        {answer.question}
                      </Text>
                      <Text color="brand.slate.700" wordBreak={'break-all'}>
                        {answer.answer || '-'}
                      </Text>
                    </Box>
                  ),
                )}
              <Box mb={4}>
                <Text
                  mb={1}
                  color="brand.slate.400"
                  fontSize="xs"
                  fontWeight={600}
                  textTransform={'uppercase'}
                >
                  Anything Else
                </Text>
                <Text color="brand.slate.700" wordBreak={'break-all'}>
                  {selectedSubmission?.otherInfo || '-'}
                </Text>
              </Box>
            </Box>
          </>
        ) : (
          <></>
        )}
      </Box>
    </>
  );
};
