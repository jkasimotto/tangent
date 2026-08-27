# Agent Shell operating vision: user intent

Date: 2026-08-27

This note preserves Julian's words before the design changes them into implementation details. It extends `../agent-shell-work-contract/user-intent.md` and `../agent-shell-navigation-model/user-intent.md`.

Source: three voice memos recorded on Julian's phone on 2026-08-27 at 18:42, 18:47, and 19:05, transcribed by the Otto launcher. The transcript is machine-made. Obvious transcription errors are corrected in brackets. Nothing else is changed.

## Memo 1 (18:42)

> I'm just going to expound some thoughts about agent shell. [What] I want to be able to do really quickly. One is just like spin up a goal or a task or whatever super quickly. I don't need to go through the brain. I can just choose the area, choose the harness, let it rip. And when it's done, maybe it can send the message to the brain.

> Second, I don't think we need the concept of handover and send anymore. Like, we can all just make it send. It's all just agent communication.

> I want to be able to very cleanly and easily define, I don't know, I'm calling them processes, where they basically like repeatable bits of my work that I want to happen at regular times or at trigger conditions that will usually involve creating a goal or something. I really want to be able to easily define those for an area. And it could be the case that, actually, sorry, I don't need to define them manually in a UI anywhere. I'm happy to have an agent do it for me. But I need to be able to read them and very clearly see what sort of processes I have, when they trigger, what their trigger [conditions] are, etc.

> Another thing I would love to kind of build out and work on [is] this whole area of figuring out how each of these harnesses work, like [Claude Code], Codex, [pi], harness things like this. There['s] a ream of information in there. For example you can probably get agents' current context from tokens. That's not super useful, but it would be useful to be able to see each individual goal's agent's token context so you can make sure I'm not going to go over or below the budget. But, sorry, more importantly though, I [want] to be able to resume conversations. That would be really cool if you could tie the conversation IDs and maybe just the command to resume the conversation, because I know that each of these harnesses has one. The command to resume the conversation gets put onto like the goal note or something so that I can always just resume a conversation from that. That would be super useful and cool and nice.

> Yeah, I think the general principle is that things that I'm not going to be changing all the time, I'm happy to have as like read-only views and I can just ask a brain to change [them].

## Memo 2 (18:47)

> That's another really important thing that I want for the agent [harnesses] and stuff is the Claude skills. Like, I would rather organize my personal agent skills and like knowledge repository for how to do things by area in tangent rather than [by] repository, for the most part. Yeah, so that's what I'm about: learning how these harnesses work and things like that, or just thinking of really simple solutions. For example telling the brain about the existence of these skills and make sure the brain knows that it should tell the workers about the existence of these skills.

> I think it would make a lot of sense to define common knowledge about how to work in that area within that area of tangent. So, for example, when I'm working at work and I want to get commits ready for review, there's usually some standard mundane things that I need to do. There's some various skills, which are, like, the repeatable things that I need to do. And you can often chain those skills together, which is exactly like a pipeline of agents.

> And the only thing that['s] really missing I guess is the first class concept at an area of kind of like a skill: a repeatable piece of work that is explained to the agent in [a] markdown file. And we don't need any like first class concept for this, I don't think. I think if we take the .agents folder and we also create a .claude folder and we [symlink] the .claude to the .agents within each area, then every brain will be aware of that, because the brains should open in the tangent repository.

> And that's another thing: the workers should never really be spawned in the tangent repository. The worker should be spawned in the work repository. Yeah, so the brains will have access to the skill and will be able to forward it or reference it to the workers to say, hey, do this. Well, this is the skill.

> Basically, that's another important thing that I think is missing. That again is kind of like a, well you can just encode that in documents in markdown files, that fits into our vault system perfectly.

## Memo 3 (19:05)

> I guess another thing that I want from my agent shell is to change the etymology or ontology of what a request to me is. So I think that should be more driven by me. I will say if I want to validate or verify a feature, and if so, we should have a clean, like, consistent user interface that's consistent with other notification systems out there, that kind of alerts me and respects the focus system as well.

## Framing (same day, in the session)

> The most recent work has been very good and steps in the correct direction.

Julian asked for a design up front, a presented vision in pragmatic Simple English, and then agreement on what needs to change before implementation.

## Julian's answers to the first draft (same evening)

> 1. I'm saying brains dont need to be blocked on me approving all goals being completed. only if i request. 2. yes. 3. sure skill-slug sounds good. 4. sure. 5. hmmm I would rotate the brain myself I think. lets get rid of that concept.

> You are overcooking it with terms etc. The operating philosophy is that tangent provides cli commands for brains to organise workers. That is it. Everything is basically md and agents and a few helpers from tangent cli. The model is less strict and more here are notes we pass around to agents etc.

> Brain questions don't notify on os yet. They can just show a little thing saying they need me. You need a harness to start any agentic work so im confused by that.

> Also each area has certain resoruces associated with it: repos, worktrees, branches etc. All this should be codified in the area note so the brain knows to start agents in the correct place. Honestly we should make it so that all interactiosn do go through the brain. I can't start an agent without the brain. And agents should not have any tangent commands except tangent agent send or whatever the communication is. And that should send to the brain (they should be told how to run that in their opening prompt). The brain can mark the goal as done etc if need be. Philosophy is that workers only have two interactiosn with tangent 1) receiving their initial prompt from brain 2) sending messages to brain. That is really it. Brain should also only really do tangent stuff mostly. Someetimes it might need to do planning and research to organise tangent work effectively that is cool too. Almost all facts for brain should be stored in md. default harness model etc is the onc exception because i want to change that manually myself. Okay go

## Julian on the brain prompt (same evening)

> It doesn't need handover or activation or whatever that is. It needs to know commands it can and should run, what tangent is, what its role is, where to look for information (hint run tangent commands mostly) and be told to read the area note basically (this essentially acts as a system prompt). Anything more than that is overkill. Tell it how to do its job which is organise info in the vault and organise worker agents.

> You can also show their area route to the root, e.g. neara/pgande/autodesign. They need to read the note from each of those for upwards context. Each area needs a main note. And we probably need some more design about how to keep the area note clean and where information should actually go. I want the area note to be like a system prompt: repositories, branches, commands, things it should know every time, what skills are available. The skills should be in that prompt, generated from the skill- slugs, just the names and descriptions (same as regular agent stuff).

## What the memos ask for, in one list

1. Start a Goal fast, without the brain: pick the Area, pick the harness, go. When it finishes, it can tell the brain.
2. One communication verb between agents: send. No separate handover concept.
3. Processes: repeatable work per Area, on a schedule or on a trigger condition, usually creating a Goal. An agent can define them. Julian must be able to read them and see exactly when and why they trigger.
4. Learn each harness. Show each Goal agent's token context. Above all, store the conversation id and the resume command on the Goal so Julian can resume any conversation.
5. Things Julian rarely changes can be read-only views. He asks a brain to change them.
6. Skills and how-to knowledge live per Area in Tangent, as Markdown. Brains see them because brains open in the Tangent repository. Brains tell workers which skill to use. A chain of skills is a pipeline of agents.
7. Workers never start in the Tangent repository. Workers start in the work repository.
8. A request to Julian is driven by Julian. He says whether he wants to verify a feature. If he does, the alert uses a clean interface consistent with other notification systems and respects the focus system.
