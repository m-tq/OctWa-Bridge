oct docs

›
bridging
bridging
moving oct from octra to Ethereum and back

the octra bridge connects native oct on octra with wOCT on Ethereum.

it lets users:

lock oct on octra and receive wOCT on Ethereum
burn wOCT on Ethereum and receive oct back on octra
denomination
the bridge uses a 1-to-1 mapping between oct and wOCT.

both assets use 6 decimals.

1 oct = 1,000,000 raw units
1 wOCT = 1,000,000 base units
a bridge amount of 5,000 OCT corresponds to 5,000 wOCT.

what the bridge does
the bridge does not swap assets through liquidity.

it moves value by changing where the representation exists:

on the way to Ethereum, oct is locked on octra and wOCT is minted on Ethereum
on the way back to octra, wOCT is burned on Ethereum and oct is unlocked on octra
this keeps the bridge in a 1-to-1 supply relationship across both sides.

oct to wOCT
to move oct from octra to Ethereum, the user bridges from the OCT -> wOCT tab.

the flow is:

connect an octra wallet and an Ethereum wallet
enter the amount of oct to bridge
enter the Ethereum recipient address
confirm the lock OCT action
after confirmation:

oct is locked on octra
the octra bridge records the lock
a lock event is emitted on octra
the interface waits for epoch confirmation
the bridge header is submitted and verified on Ethereum
the final claim wOCT step becomes available
the user confirms the Ethereum transaction in MetaMask
wOCT is minted to the recipient wallet on Ethereum
the octra-side transaction uses lock_to_eth.

the Ethereum-side flow includes bridge header submission and a final mint transaction that credits wOCT to the recipient wallet.

wOCT to oct
to move value back from Ethereum to octra, the user bridges from the wOCT -> OCT tab.

the flow is:

connect an octra wallet and an Ethereum wallet
enter the amount of wOCT to bridge back
enter the octra recipient address
confirm the burn wOCT action
because wOCT is an ERC-20 token, the return flow first requires token approval.

the sequence is:

approve wOCT spend
burn wOCT
unlock OCT on octra
after confirmation:

MetaMask asks for an approval transaction
MetaMask asks for the burn transaction
wOCT is burned on Ethereum
oct is unlocked on octra
the octra bridge records the unlock and emits an unlock event
the Ethereum burn appears as a transfer of wOCT to the zero address.

the octra-side transaction uses unlock_trusted.

timing
the bridge takes roughly ~2 minutes to complete.

bridging is not a single transaction.

the full path includes:

a source-chain action
bridge processing
header or event handling
a destination-side finalization step
for oct to wOCT, the user waits until the bridge header is available on Ethereum before claiming.

for wOCT to oct, the user waits until the burn is confirmed and processed before oct is unlocked on octra.

fees
the bridge fee is set to 0. the bridge does not charge an additional protocol fee.

users still pay normal network gas for the transactions they sign.

in practice:

oct to wOCT includes an octra-side lock transaction and an Ethereum-side claim transaction
wOCT to oct includes an Ethereum approval transaction, an Ethereum burn transaction, and an octra-side unlock flow
wallet behavior
after a successful oct to wOCT bridge:

the oct balance on octra decreases by the bridged amount
the wOCT balance on Ethereum increases by the same amount
after a successful wOCT to oct bridge:

the wOCT balance on Ethereum decreases by the bridged amount
the oct balance on octra increases by the same amount
bridge finalization model
the bridge is two-step in each direction.

oct to wOCT

user locks oct on octra
bridge data is carried to Ethereum
the Ethereum side verifies the bridge header
user submits the final claim transaction
wOCT is minted
wOCT to oct

user approves wOCT spending
user burns wOCT on Ethereum
the bridge processes the burn
oct is unlocked on octra
in both directions, the user should expect a bridge process rather than an instant wallet-to-wallet transfer.

scope on Ethereum
wOCT is a standard Ethereum-side wrapped asset.

it is used for normal EVM activity such as:

transfers
trading
liquidity provision
defi integrations
it does not carry octra’s encrypted balances, encrypted transfers, or encrypted execution model onto Ethereum.

on Ethereum, wOCT behaves as a conventional wrapped token.

implementation notes
the bridge uses:

lock_to_eth for octra-side locking
unlock_trusted for octra-side unlocking
Ethereum-side header verification before claim
Ethereum-side mint on claim
Ethereum-side approval and burn for the return flow
the bridge flow is simple at the asset level:

lock oct to receive wOCT
burn wOCT to receive oct back